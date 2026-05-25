# Technical Research — PDF-to-CSV Extraction Approaches

Last updated: 2026-05-25

## The Core Challenge

Every vendor's PDF layout is different. Columns shift, labels change ("INV#" vs "No. Invoice" vs "Ref"), table structures vary, and languages mix (Bahasa Indonesia + English). Traditional template-based OCR tools require a template per vendor — which doesn't scale.

## Approach Comparison

### A. Traditional PDF Libraries

| Library | Approach | Layout-Agnostic? | Handles Mixed BI/EN? | Table Extraction |
|---------|----------|-----------------|---------------------|-----------------|
| **PyMuPDF (fitz)** | Text extraction from PDF internals | No — position-dependent | No — raw text only | Poor — loses table structure |
| **pdfplumber** | Text + basic table detection | Partial — needs grid lines | No | Only works with bordered tables |
| **Camelot** | Lattice + stream table detection | Partial — stream mode helps | No | Works for simple tables, fails on complex layouts |
| **Tabula** | Like Camelot, less maintained | Partial | No | Similar limitations |
| **Tesseract OCR** | Traditional OCR | Bad — needs pre-processing | Poor for mixed scripts | No inherent table understanding |

**Verdict:** None of these solve the "every layout is different" problem. They're brittle and require document-specific configuration.

### B. LLM Vision APIs (RECOMMENDED)

Convert PDF pages to images, then ask a multi-modal LLM to extract structured fields. This is inherently layout-agnostic.

| Provider | Model | Cost per 1K pages | Latency | BI/EN Accuracy | Notes |
|----------|-------|-------------------|---------|----------------|-------|
| **Anthropic** | Claude Sonnet 4 | ~$2.40 (input) + ~$3.75 (output) = ~$6.15 | 2-5s | Excellent — generalized multi-lingual vision | **Best value** — fast, accurate, good with tables |
| **OpenAI** | GPT-4o Vision | ~$10 (input) + ~$5 (output) = ~$15 | 3-8s | Excellent | More expensive, comparable accuracy |
| **Google** | Gemini 2.0 / 1.5 Pro | ~$0.50-1.50 | 1-3s | Good for text, weaker on complex tables | Cheapest but less reliable for structured extraction |
| **OpenAI** | GPT-4o-mini | ~$1 (input) + ~$0.50 (output) = ~$1.50 | 1-3s | Good (less detail) | Worth testing as cheaper fallback |

**Cost per document (single page):** $0.002-0.015 using Claude Sonnet 4
**Cost per 10-document batch:** $0.02-0.15

### C. Open Source / Self-Hosted LLM Vision

| Option | Cost | Notes |
|--------|------|-------|
| **Llama 3.2 Vision (11B)** | Free (self-hosted) | Requires GPU (24GB+ VRAM), accuracy not as good |
| **Qwen2-VL** | Free (self-hosted) | Promising but not production-ready for complex tables |
| **Pixtral (Mistral)** | Free (self-hosted) | New, unproven for invoice extraction |

**Verdict:** Self-hosted vision models aren't accurate enough for production invoice extraction yet. API-based is the right call for MVP.

## Recommended Architecture

### Simplest MVP Stack

```
[User] → Upload ZIP of PDFs
           ↓
     [FastAPI Backend]
           ↓
     Convert PDF → PNG images (pdf2image / poppler-utils)
           ↓
     Send each page to Claude Sonnet 4
         Prompt: "Extract Invoice #, Date, Grand Total, Vendor Name, and Line Items from this invoice image. Return as JSON."
           ↓
     [Structured JSON]
           ↓
     Compile all results → CSV download
           ↓
     (Optional) Push to Google Sheets via API
```

### Why This Works

1. **No templates** — LLM understands layout visually, regardless of format
2. **Handles BI/EN** — Claude handles mixed languages naturally
3. **Batch by design** — upload 50 PDFs, process sequentially, get one CSV
4. **Simple deployment** — one Python server, one API key
5. **Cheap** — $0.002-0.01 per invoice at MVP scale

### Dependencies (MVP)

```bash
python = "^3.11"
fastapi = "^0.110"
uvicorn = "^0.27"
python-multipart = "^0.0"    # File uploads
pdf2image = "^1.16"          # PDF→PNG conversion
anthropic = "^0.30"          # Claude API
# or
openai = "^1.0"              # GPT-4o Vision
# plus
pandas = "^2.0"              # CSV compilation
```

System dependency: `poppler-utils` (for pdf2image) — `apt install poppler-utils`

### Alternative: Go + pdfcpu (lighter backend)

If we want a compiled binary (easier deployment, no Python runtime dependency):
- Go Fastify/Echo for the HTTP server
- pdfcpu or Go bindings to poppler for PDF→image
- Direct Anthropic/OpenAI API calls

But Python is faster to prototype and had better PDF tooling.

## Extraction Prompt Design

Key insight: The prompt is the product. A well-designed extraction prompt handles layout variance better than any template system.

```python
SYSTEM_PROMPT = """You are an invoice data extraction assistant. 
Extract the following fields from the invoice image:

Required fields:
- invoice_number: string (e.g., "INV-2024-00123")
- date: string in YYYY-MM-DD format
- vendor_name: string
- grand_total: number (decimal)
- currency: string (e.g., "IDR", "USD")
- line_items: array of {description, quantity, unit_price, total}

Rules:
- The invoice may be in Bahasa Indonesia, English, or mixed
- If a field is not found, return null — do not guess
- Convert dates to YYYY-MM-DD format
- Grand total means the final total after all taxes and discounts
- Extract ALL line items visible in the table

Return ONLY valid JSON, no other text."""
```

## Fallback Strategy

For production, implement a layered approach:

1. **Try Claude Sonnet 4** — primary extractor (best accuracy/cost)
2. **Fallback to PyMuPDF text extraction** — if the API fails (network) or the PDF is scanned/illegible
3. **User correction** — let users fix misreads in the review interface (this also generates training data)

## Google Sheets Integration

- Use `gspread` Python library with OAuth2 service account
- User authenticates once (OAuth flow), app creates a new sheet per batch
- Each batch = one sheet tab with columns: Filename, Invoice #, Date, Vendor, Grand Total, Line Items (as JSON or expanded)

## Key Risks

| Risk | Mitigation |
|------|-----------|
| **API cost at scale** (1000+ PDFs/month = $2-15) | Negotiate volume pricing, cache results |
| **LLM hallucinates fields** | Constrain with strict JSON schema, user review step |
| **Scanned PDFs / poor quality** | Pre-process with image enhancement, multiple LLM retries |
| **Large PDFs (50+ pages)** | Page limit with smart sampling |
| **API downtime** | Multi-provider fallback (Claude → GPT-4o → Gemini) |
