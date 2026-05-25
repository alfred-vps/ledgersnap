"""LedgerSnap — PDF-to-image conversion layer.

Converts uploaded PDF files into JPEG page images suitable for Claude Vision.
Handles multipage PDFs, scanned/image-based PDFs, and corrupt file detection.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Optional

from pdf2image import convert_from_path
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError

from .config import settings


def pdf_to_images(
    pdf_path: Path,
    output_dir: Optional[Path] = None,
    max_pages: int = 20,
    dpi: int = 200,
) -> list[Path]:
    """Convert a PDF file to a list of JPEG image paths (one per page).

    Args:
        pdf_path: Path to the PDF file.
        output_dir: Directory to save images. If None, uses a temp dir.
        max_pages: Maximum number of pages to convert (cap API costs).
        dpi: Image resolution. 200 DPI is good for OCR-quality without
             blowing up file sizes. Claude Vision handles lower DPI fine.

    Returns:
        Ordered list of paths to generated JPEG images.

    Raises:
        ValueError: If the PDF is corrupt, password-protected, or has 0 pages.
        RuntimeError: If poppler-utils is not installed.
    """
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="ledgersnap_"))
    else:
        output_dir.mkdir(parents=True, exist_ok=True)

    try:
        images = convert_from_path(
            str(pdf_path),
            dpi=dpi,
            fmt="jpeg",
            thread_count=2,
            grayscale=True,          # Invoices are usually B/W — saves tokens
            first_page=1,
            last_page=max_pages,
            size=(2000, None),       # Cap width at 2000px, height auto
        )
    except PDFInfoNotInstalledError as exc:
        raise RuntimeError(
            "poppler-utils is not installed. Run: apt-get install -y poppler-utils"
        ) from exc
    except PDFPageCountError as exc:
        raise ValueError(f"Cannot read PDF page count — file may be corrupt: {exc}") from exc
    except Exception as exc:
        raise RuntimeError(f"Failed to convert PDF to images: {exc}") from exc

    if not images:
        raise ValueError("PDF has 0 pages or could not be rendered")

    output_paths: list[Path] = []
    for i, img in enumerate(images):
        page_path = output_dir / f"page_{i + 1:03d}.jpg"
        img.save(str(page_path), "JPEG", quality=85)
        output_paths.append(page_path)

    return output_paths


def get_pdf_page_count(pdf_path: Path) -> int:
    """Quickly count pages without rendering the full PDF.

    Uses pdf2image's internal pdftoppm to get page count, which is much
    faster than rendering all pages.
    """
    try:
        images = convert_from_path(
            str(pdf_path),
            dpi=72,
            fmt="jpeg",
            first_page=1,
            last_page=1,
        )
        # We only converted the first page — but pdf2image tells us if
        # the PDF has at least 1 page
        if images:
            # A more accurate count requires pdfinfo
            import subprocess
            result = subprocess.run(
                ["pdfinfo", str(pdf_path)],
                capture_output=True,
                text=True,
                timeout=10,
            )
            for line in result.stdout.split("\n"):
                if "Pages" in line:
                    parts = line.split(":")
                    if len(parts) == 2:
                        return int(parts[1].strip())
            return 1
        return 0
    except Exception:
        return 0
