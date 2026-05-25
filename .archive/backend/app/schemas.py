"""
LedgerSnap — Pydantic schemas for job state, file tracking, and extraction results.

These models define the exact shape of every object that flows through the system.
Every field has a clear semantic meaning — no ambiguous types.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class FileStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class Currency(str, Enum):
    IDR = "IDR"
    USD = "USD"
    unknown = "unknown"


# ──────────────────────────────────────────────
# Line Items
# ──────────────────────────────────────────────

class LineItem(BaseModel):
    """A single row in an invoice line-item table."""
    description: str = ""
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total: Optional[float] = None


# ──────────────────────────────────────────────
# Extraction Result (per-file)
# ──────────────────────────────────────────────

class ExtractedInvoice(BaseModel):
    """Structured data extracted from one PDF invoice."""
    invoice_number: Optional[str] = None
    date: Optional[str] = None  # YYYY-MM-DD after normalization
    vendor_name: Optional[str] = None
    vendor_tax_id: Optional[str] = None  # e.g. NPWP "02.123.456.7-888.000"
    currency: Currency = Currency.unknown
    grand_total: Optional[float] = None
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = None
    line_items: list[LineItem] = Field(default_factory=list)
    raw_text_fields: dict[str, str] = Field(
        default_factory=dict,
        description="Fallback: any field we couldn't parse cleanly, stored as key-value text"
    )


class FileResult(BaseModel):
    """Result for a single processed PDF file."""
    file_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    filename: str
    page_count: int = 0
    status: FileStatus = FileStatus.pending
    error: Optional[str] = None

    extracted: Optional[ExtractedInvoice] = None
    user_corrections: Optional[ExtractedInvoice] = None
    confirmed: bool = False


# ──────────────────────────────────────────────
# Job (top-level processing unit)
# ──────────────────────────────────────────────

class Job(BaseModel):
    """A complete processing job — one batch of uploaded PDFs."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: JobStatus = JobStatus.pending
    progress: str = "0/0"  # e.g. "3/10"
    error: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    files: list[FileResult] = Field(default_factory=list)
    csv: Optional[str] = None  # cached CSV string once compiled


# ──────────────────────────────────────────────
# API Request / Response models
# ──────────────────────────────────────────────

class JobCreateResponse(BaseModel):
    """Returned immediately after uploading files."""
    job_id: str
    status: JobStatus = JobStatus.pending
    file_count: int
    redirect_url: str = ""


class JobStatusResponse(BaseModel):
    """Polling response — frontend uses this to show progress."""
    job_id: str
    status: JobStatus
    progress: str
    files: list[FileResult]
    created_at: str
    updated_at: str


class CorrectionPayload(BaseModel):
    """Payload for PUT /api/v1/jobs/:id/results/:file_id."""
    invoice_number: Optional[str] = None
    date: Optional[str] = None
    vendor_name: Optional[str] = None
    vendor_tax_id: Optional[str] = None
    currency: Optional[str] = None
    grand_total: Optional[float] = None
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = None
    confirmed: bool = False
