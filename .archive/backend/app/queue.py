"""
LedgerSnap — Job queue / state tracking.

Two-layer approach:
1. In-memory dict: fast O(1) lookups for active job polling
2. SQLite: persistent storage so jobs survive a server restart

The queue uses asyncio for non-blocking background processing
so the API stays responsive during extraction.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .schemas import (
    CorrectionPayload,
    FileResult,
    FileStatus,
    Job,
    JobStatus,
)

# ──────────────────────────────────────────────
# SQLite setup
# ──────────────────────────────────────────────

DB_PATH = Path(__file__).resolve().parent.parent / "ledgersnap.db"

# Thread-local so we don't share connections across threads
_local = threading.local()


def _get_db() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(str(DB_PATH))
        _local.conn.row_factory = sqlite3.Row
        _init_db(_local.conn)
    return _local.conn


def _init_db(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'pending',
            data TEXT NOT NULL,       -- JSON-serialized Job
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            FOREIGN KEY (job_id) REFERENCES jobs(id)
        )
    """)
    conn.commit()


# ──────────────────────────────────────────────
# In-memory manager
# ──────────────────────────────────────────────

class JobQueue:
    """
    Manages job lifecycle with an in-memory dict for fast polling,
    backed by SQLite for crash recovery.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}

    # ── CRUD ──────────────────────────────────

    def create_job(self, filenames: list[str]) -> Job:
        job = Job(
            status=JobStatus.pending,
            progress=f"0/{len(filenames)}",
            files=[
                FileResult(filename=fname)
                for fname in filenames
            ],
        )
        with self._lock:
            self._jobs[job.id] = job
            self._persist_job(job)
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                return job
        # Fallback: try loading from SQLite (survived restart)
        return self._load_job(job_id)

    def update_job(self, job: Job) -> None:
        job.updated_at = datetime.now(timezone.utc)
        with self._lock:
            self._jobs[job.id] = job
            self._persist_job(job)

    def delete_job(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)
            self._remove_job_from_db(job_id)

    # ── File-level helpers ────────────────────

    def mark_file_processing(self, job_id: str, file_id: str) -> None:
        job = self.get_job(job_id)
        if job is None:
            return
        for f in job.files:
            if f.file_id == file_id:
                f.status = FileStatus.processing
                break
        self.update_job(job)

    def mark_file_completed(
        self, job_id: str, file_id: str, result: object, page_count: int = 0
    ) -> None:
        job = self.get_job(job_id)
        if job is None:
            return
        for f in job.files:
            if f.file_id == file_id:
                f.status = FileStatus.completed
                f.extracted = result
                f.page_count = page_count
                break
        self._recalc_progress(job)
        self.update_job(job)

    def mark_file_failed(self, job_id: str, file_id: str, error: str) -> None:
        job = self.get_job(job_id)
        if job is None:
            return
        for f in job.files:
            if f.file_id == file_id:
                f.status = FileStatus.failed
                f.error = error
                break
        self._recalc_progress(job)
        self.update_job(job)

    def apply_correction(
        self, job_id: str, file_id: str, payload: CorrectionPayload
    ) -> Optional[FileResult]:
        job = self.get_job(job_id)
        if job is None:
            return None
        target = None
        for f in job.files:
            if f.file_id == file_id:
                target = f
                break
        if target is None or target.extracted is None:
            return None

        # Apply corrections on top of extracted data
        corr = target.extracted.model_copy(deep=True)
        if payload.invoice_number is not None:
            corr.invoice_number = payload.invoice_number
        if payload.date is not None:
            corr.date = payload.date
        if payload.vendor_name is not None:
            corr.vendor_name = payload.vendor_name
        if payload.vendor_tax_id is not None:
            corr.vendor_tax_id = payload.vendor_tax_id
        if payload.currency is not None:
            corr.currency = payload.currency  # type: ignore
        if payload.grand_total is not None:
            corr.grand_total = payload.grand_total
        if payload.subtotal is not None:
            corr.subtotal = payload.subtotal
        if payload.tax_amount is not None:
            corr.tax_amount = payload.tax_amount

        target.user_corrections = corr
        target.confirmed = payload.confirmed
        self.update_job(job)
        return target

    def check_completion(self, job: Job) -> None:
        """If all files are done (completed or failed), mark job completed."""
        if job.status != JobStatus.processing:
            return
        all_done = all(
            f.status in (FileStatus.completed, FileStatus.failed)
            for f in job.files
        )
        if all_done:
            job.status = JobStatus.completed
            self.update_job(job)

    # ── Internal helpers ───────────────────────

    def _recalc_progress(self, job: Job) -> None:
        done = sum(
            1 for f in job.files
            if f.status in (FileStatus.completed, FileStatus.failed)
        )
        total = len(job.files)
        job.progress = f"{done}/{total}"

    def _persist_job(self, job: Job) -> None:
        try:
            conn = _get_db()
            data = job.model_dump_json()
            conn.execute(
                """
                INSERT OR REPLACE INTO jobs (id, status, data, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    job.id,
                    job.status.value,
                    data,
                    job.created_at.isoformat(),
                    job.updated_at.isoformat(),
                ),
            )
            conn.commit()
        except Exception:
            pass  # Non-critical — in-memory copy still works

    def _load_job(self, job_id: str) -> Optional[Job]:
        try:
            conn = _get_db()
            row = conn.execute(
                "SELECT data FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if row is None:
                return None
            job = Job.model_validate_json(row["data"])
            with self._lock:
                self._jobs[job.id] = job  # Restore to memory
            return job
        except Exception:
            return None

    def _remove_job_from_db(self, job_id: str) -> None:
        try:
            conn = _get_db()
            conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            conn.execute("DELETE FROM files WHERE job_id = ?", (job_id,))
            conn.commit()
        except Exception:
            pass


# ── Singleton ──────────────────────────────────

queue: JobQueue = JobQueue()
