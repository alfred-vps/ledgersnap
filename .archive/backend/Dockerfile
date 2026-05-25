# ──────────────────────────────────────────────────────
# LedgerSnap — Backend Dockerfile
# ──────────────────────────────────────────────────────
# CRITICAL: poppler-utils is REQUIRED by pdf2image for
# PDF→JPEG conversion. Without it, the container will
# crash with "PDFInfoNotInstalledError".
# ──────────────────────────────────────────────────────

FROM python:3.12-slim

# ── System dependencies ──────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ──────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Application code ─────────────────────────
COPY app/ ./app/

# ── Runtime ──────────────────────────────────
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
