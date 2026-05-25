"""
LedgerSnap — FastAPI application entrypoint.

Endpoints:
  POST   /api/v1/jobs              → Upload PDFs, create processing job
  GET    /api/v1/jobs/{job_id}     → Poll job status & results
  GET    /api/v1/jobs/{job_id}/download → Download compiled CSV
  PUT    /api/v1/jobs/{job_id}/results/{file_id} → Apply user corrections
  DELETE /api/v1/jobs/{job_id}     → Cancel/delete a job
"""

from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .compiler import compile_csv
from .config import settings
from .extractor import extract_invoice
from .pdf_processor import pdf_to_images
from .queue import queue
from .schemas import (
    CorrectionPayload,
    FileStatus,
    JobCreateResponse,
    JobStatus,
    JobStatusResponse,
)

app = FastAPI(
    title="LedgerSnap API",
    version="0.1.0",
    docs_url="/docs",
)

# CORS — allow Next.js dev server and production origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://ledgersnap.fly.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@app.post("/api/v1/jobs", response_model=JobCreateResponse)
async def create_job(files: list[UploadFile] = File(...)):
    """Upload one or more PDF files and start processing."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    if len(files) > settings.max_files_per_job:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {settings.max_files_per_job} files per job",
        )

    # Validate all files are PDFs
    filenames: list[str] = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"File '{f.filename}' is not a PDF",
            )
        filenames.append(f.filename)

    # Create job in queue
    job = queue.create_job(filenames)

    # Save uploaded files
    upload_dir = Path(settings.upload_dir) / job.id
    upload_dir.mkdir(parents=True, exist_ok=True)

    for f, filename in zip(files, filenames):
        content = await f.read()
        (upload_dir / filename).write_bytes(content)

    # Start background processing
    asyncio.create_task(_process_job(job.id, upload_dir))

    return JobCreateResponse(
        job_id=job.id,
        status=job.status,
        file_count=len(files),
        redirect_url=f"/jobs/{job.id}",
    )


@app.get("/api/v1/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    """Poll job status and results."""
    job = queue.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatusResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        files=job.files,
        created_at=job.created_at.isoformat(),
        updated_at=job.updated_at.isoformat(),
    )


@app.get("/api/v1/jobs/{job_id}/download")
async def download_csv(job_id: str):
    """Download the compiled CSV for a completed job."""
    job = queue.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.completed:
        raise HTTPException(status_code=400, detail="Job is not yet completed")

    # Re-compile fresh to include any user corrections
    csv_data = compile_csv(job.files)

    return PlainTextResponse(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=ledgersnap_{job.id}.csv"
        },
    )


@app.put("/api/v1/jobs/{job_id}/results/{file_id}")
async def update_correction(job_id: str, file_id: str, payload: CorrectionPayload):
    """Apply user corrections to a specific file's extraction result."""
    result = queue.apply_correction(job_id, file_id, payload)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Job or file not found, or file has no extraction yet",
        )
    return {"status": "updated", "file_id": file_id, "confirmed": payload.confirmed}


@app.delete("/api/v1/jobs/{job_id}")
async def delete_job(job_id: str):
    """Cancel and delete a job and its uploaded files."""
    job = queue.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    queue.delete_job(job_id)

    # Clean up uploaded files
    upload_dir = Path(settings.upload_dir) / job_id
    if upload_dir.exists():
        shutil.rmtree(upload_dir, ignore_errors=True)

    return {"status": "deleted", "job_id": job_id}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ledgersnap-backend"}


# ─────────────────────────────────────────────
# Background processing
# ─────────────────────────────────────────────

async def _process_job(job_id: str, upload_dir: Path) -> None:
    """Background task: process all files in a job sequentially.

    Each PDF is converted to images, sent to Claude Vision for extraction,
    and the result is stored in the job state.
    """
    job = queue.get_job(job_id)
    if job is None:
        return

    job.status = JobStatus.processing
    queue.update_job(job)

    from anthropic import Anthropic
    client = Anthropic(api_key=settings.anthropic_api_key)

    for file_result in job.files:
        file_result.status = FileStatus.processing
        queue.update_job(job)

        pdf_path = upload_dir / file_result.filename

        if not pdf_path.exists():
            queue.mark_file_failed(job_id, file_result.file_id, "File not found after upload")
            continue

        try:
            # Step 1: Convert PDF to images (runs in executor to avoid blocking)
            loop = asyncio.get_event_loop()
            image_paths = await loop.run_in_executor(
                None,
                pdf_to_images,
                pdf_path,
                None,  # auto temp dir
                settings.max_pages_per_pdf,
                200,
            )

            # Step 2: Extract invoice data via Claude Vision
            extracted = await loop.run_in_executor(
                None,
                extract_invoice,
                image_paths,
                client,
                settings.extraction_retries,
            )

            # Step 3: Store result
            queue.mark_file_completed(
                job_id, file_result.file_id,
                extracted, page_count=len(image_paths),
            )

        except Exception as exc:
            queue.mark_file_failed(
                job_id, file_result.file_id,
                f"{type(exc).__name__}: {exc}",
            )

    # Check if all files are done
    job = queue.get_job(job_id)
    if job:
        queue.check_completion(job)

        # Compile CSV upfront for fast download
        if job.status == JobStatus.completed:
            job.csv = compile_csv(job.files)
            queue.update_job(job)


# ─────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
