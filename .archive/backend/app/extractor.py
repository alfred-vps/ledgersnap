"""
LedgerSnap — Claude Sonnet 4 Vision extraction engine.

This module is the CORE of the product. It converts PDF page images into
structured invoice data using a carefully crafted prompt architecture
that is layout-agnostic, handles mixed languages (BI/EN), and extracts
line items from any table format.

Prompt Design Philosophy:
- The prompt IS the product. Every line is tuned for invoice extraction.
- We send a SYSTEM prompt (role + rules + schema) once per session,
  then USER messages with the image(s) + brief instructions.
- The strict JSON output constraint eliminates markdown wrapping.
- For multi-page invoices, all pages are sent in one request so Claude
  can cross-reference (e.g. line items continuing on page 2).
"""

from __future__ import annotations

import base64
import json
import re
import time
from pathlib import Path
from typing import Optional

from anthropic import Anthropic, APIStatusError, RateLimitError

from .config import settings
from .schemas import Currency, ExtractedInvoice, LineItem

# ═══════════════════════════════════════════════
# SYSTEM PROMPT — the extraction instruction set
# ═══════════════════════════════════════════════

SYSTEM_PROMPT = """You are an expert invoice data extraction assistant for LedgerSnap, serving Indonesian SMEs. You extract structured data from scanned invoice PDFs regardless of layout, language, or format.

## EXTRACTION FIELDS (extract ALL of these):

1. **invoice_number**: Any invoice identifier — "INV-2024-00123", "Faktur No. 001", "INVOICE 123", "No. Faktur: ...", "FA-2403-001". Look near the top of the page, often beside "Invoice", "Faktur", "No.", "Ref", "INV#".

2. **date**: The invoice issuance date. Convert to YYYY-MM-DD. Common labels: "Date", "Tanggal", "Tgl", "Issued", "Dated". Examples of conversion:
   - "15 Maret 2024" → "2024-03-15"
   - "03/15/2024" → "2024-03-15" (prefer DD/MM if ambiguous — Indonesian convention)
   - "2024-03-15" → "2024-03-15"
   - "Maret 2024" (no day given) → "2024-03-01"
   - "15-Mar-24" → "2024-03-15"

3. **vendor_name**: The company issuing the invoice. Look at letterhead, header, "From:", or the top of the document. Often includes legal suffixes: "PT", "CV", "UD", "Firma".

4. **vendor_tax_id**: Tax registration ID. Primary format is **NPWP** ("02.123.456.7-888.000"). Also look for "NIB", "SIUP", "PKP" references. In Indonesian invoices, NPWP is on nearly every valid invoice.

5. **currency**: Currency code. "Rp", "IDR", "Rupiah" → IDR. "$", "USD", "Dollar" → USD. Default IDR for Indonesian-looking invoices.

6. **subtotal**: Amount before tax/discount. Labels: "Subtotal", "Jumlah", "Dasar Pengenaan Pajak" (DPP in Indonesian tax invoices).

7. **tax_amount**: Tax amount. Labels: "PPN", "VAT", "Pajak", "Tax", "PPN 11%", "PPn". Indonesian invoices typically show PPN at 11%.

8. **grand_total**: The FINAL total after all taxes and discounts. Labels: "Grand Total", "Total", "Jumlah Dibayar", "Total Bayar", "Terbilang" (amount in words — use the numeric value). This is the most important field.

9. **line_items**: EVERY row from the product/service table. Extract ALL rows.

## LINE ITEM EXTRACTION (most important — be thorough)

The line-item table is the hardest part because layouts vary wildly. Use these strategies:

1. **Identify the table boundaries**: Look for a grid or aligned columns with headers like:
   - Indonesian: "No", "Nama Barang/Jasa", "Qty", "Harga Satuan", "Jumlah Harga"
   - English: "Item", "Description", "Qty", "Unit Price", "Amount"
   - Mixed: columns arranged side by side with a total at the bottom

2. **Extract EVERY row**: Sometimes there are 50+ rows. Do NOT truncate. Every single product or service line must be captured.

3. **For each row, extract**:
   - `description`: The product/service name (required)
   - `quantity`: Number of units (numeric)
   - `unit_price`: Price per single unit (numeric)
   - `total`: Line total = quantity × unit_price (numeric)

4. **Handle special rows**: Discounts, shipping charges, or tax-only lines should be extracted as line items with descriptive descriptions like "Diskon 10%" or "Ongkos Kirim".

5. **Multi-page tables**: If the table continues on the next page, merge ALL rows into one unified `line_items` array.

## CRITICAL RULES:

1. **NULL vs GUESS**: If a field is not present in the document, set it to null. Do NOT fabricate values. It is better to have null than a wrong guess.

2. **STRICT OUTPUT**: Return ONLY a valid JSON object matching the schema below. No markdown fences (```json), no explanations, no conversational text. JUST the JSON.

3. **NUMBER FORMATS**: Handle both:
   - Indonesian: "1.500.000,00" (dots as thousands separators, comma as decimal)
   - US: "1,500,000.00" (commas as thousands separators, dot as decimal)
   Read these correctly and output as plain numbers (1500000.00).

4. **LANGUAGE**: Invoices may mix Bahasa Indonesia and English freely. Extract the fields regardless of label language.

## OUTPUT SCHEMA (return this exact structure):

{
  "invoice_number": "string or null",
  "date": "YYYY-MM-DD string or null",
  "vendor_name": "string or null",
  "vendor_tax_id": "string or null",
  "currency": "IDR | USD | unknown",
  "subtotal": "number or null",
  "tax_amount": "number or null",
  "grand_total": "number or null",
  "line_items": [
    {
      "description": "string (required)",
      "quantity": "number or null",
      "unit_price": "number or null",
      "total": "number or null"
    }
  ],
  "raw_text_fields": {}
}"""


# ═══════════════════════════════════════════════
# Image handling
# ═══════════════════════════════════════════════

def _image_to_base64(image_path: Path) -> tuple[str, str]:
    """Read an image file and return (base64_encoded_data, media_type).

    pdf2image saves as JPEG by default (low file size → cheaper API calls).
    We detect the actual format from file extension for correctness.
    """
    suffix = image_path.suffix.lower()
    media_type = "image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png"

    with open(image_path, "rb") as f:
        data = f.read()

    return base64.b64encode(data).decode("utf-8"), media_type


def _estimate_image_tokens(width: int, height: int) -> int:
    """Rough token cost estimate for Claude Vision (tile-based accounting).

    Claude processes images in 512×512 tiles. This is used for logging,
    not for actual billing.
    """
    tiles_x = (width + 511) // 512
    tiles_y = (height + 511) // 512
    total_tiles = tiles_x * tiles_y
    return total_tiles * 258  # ~258 tokens per tile for Sonnet


# ═══════════════════════════════════════════════
# Response parsing
# ═══════════════════════════════════════════════

def _parse_claude_response(raw_text: str) -> dict:
    """Extract and parse JSON from Claude's response text.

    Three recovery strategies in order:
    1. Direct parse — if the model obeyed the "JSON only" instruction
    2. Code block extraction — if it wrapped in ```json ... ```
    3. Regex object find — last resort for garbled responses
    """
    raw_text = raw_text.strip()

    # Strategy 1: Direct JSON parse
    if raw_text.startswith("{"):
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError:
            pass

    # Strategy 2: Extract from markdown code block
    json_match = re.search(
        r"```(?:json)?\s*\n?(\{.*?\})\s*\n?```", raw_text, re.DOTALL
    )
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Strategy 3: Regex find any top-level JSON object
    # This handles cases where the model mixed text and JSON
    depth = 0
    start = -1
    for i, ch in enumerate(raw_text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    return json.loads(raw_text[start:i+1])
                except json.JSONDecodeError:
                    start = -1  # Reset and try next object
                    continue

    raise ValueError(
        f"Could not parse Claude response as JSON. "
        f"Raw text (first 500 chars): {raw_text[:500]}"
    )


def _normalize_extracted(raw: dict) -> ExtractedInvoice:
    """Clean and validate the raw dict from Claude into our typed schema.

    This layer handles:
    - Case normalization (Claude sometimes outputs "Invoice_Number")
    - Number parsing (Indonesian/US format ambiguity)
    - Currency code normalization
    - Empty line item filtering
    """
    # Map common alternative field names Claude might use
    field_map = {
        "Invoice_Number": "invoice_number",
        "InvoiceNo": "invoice_number",
        "inv_no": "invoice_number",
        "InvoiceDate": "date",
        "Tanggal": "date",
        "Vendor": "vendor_name",
        "Supplier": "vendor_name",
        "NPWP": "vendor_tax_id",
        "Total": "grand_total",
        "GrandTotal": "grand_total",
        "Jumlah": "grand_total",
        "PPN": "tax_amount",
        "VAT": "tax_amount",
        "DPP": "subtotal",
        "DasarPengenaanPajak": "subtotal",
        "Items": "line_items",
        "LineItems": "line_items",
    }

    def _get(key: str, default=None):
        """Get a field, checking alternative names."""
        val = raw.get(key)
        if val is not None:
            return val
        alt = field_map.get(key)
        if alt:
            return raw.get(alt)
        # Check case-insensitive
        for k, v in raw.items():
            if k.lower().replace("_", "").replace(" ", "") == key.lower().replace("_", "").replace(" ", ""):
                return v
        return default

    return ExtractedInvoice(
        invoice_number=_get("invoice_number") or None,
        date=_get("date") or None,
        vendor_name=_get("vendor_name") or None,
        vendor_tax_id=_get("vendor_tax_id") or None,
        currency=_parse_currency(_get("currency")),
        subtotal=_parse_number(_get("subtotal")),
        tax_amount=_parse_number(_get("tax_amount")),
        grand_total=_parse_number(_get("grand_total")),
        line_items=[
            LineItem(
                description=str(item.get("description", "")),
                quantity=_parse_number(item.get("quantity")),
                unit_price=_parse_number(item.get("unit_price")),
                total=_parse_number(item.get("total")),
            )
            for item in (_get("line_items") or [])
            if str(item.get("description", "")).strip()
        ],
        raw_text_fields=raw.get("raw_text_fields") or {},
    )


def _parse_currency(val) -> Currency:
    """Normalize currency strings to our enum."""
    if not val:
        return Currency.unknown
    val = str(val).upper().strip()
    if "IDR" in val or "RP" in val:
        return Currency.IDR
    if "USD" in val or val == "$":
        return Currency.USD
    return Currency.unknown


def _parse_number(val) -> Optional[float]:
    """Parse a number from various string formats.

    Handles:
    - Plain: 1500000
    - US: 1,500,000.00
    - Indonesian: 1.500.000,00
    - Mixed: Rp 1.500.000
    - Scientific notation is rare in invoices but handled by float()
    """
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)

    cleaned = str(val).strip()

    # Remove currency prefixes/suffixes
    cleaned = re.sub(r"^(Rp|IDR|USD|\$)\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*(Rp|IDR|USD|\$)$", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip()

    # Remove non-numeric chars except digits, dots, commas, minus
    cleaned = re.sub(r"[^\d.,\-]", "", cleaned)
    if not cleaned:
        return None

    # Detect format: Indonesian uses dots as thousands, comma as decimal
    # US/European uses commas as thousands, dot as decimal
    has_comma = "," in cleaned
    has_dot = "." in cleaned

    if has_comma and has_dot:
        # Check which separator is last — that's the decimal
        last_comma = cleaned.rfind(",")
        last_dot = cleaned.rfind(".")
        if last_comma > last_dot:
            # Indonesian: 1.500.000,00
            cleaned = cleaned.replace(".", "")   # Remove thousands dots
            cleaned = cleaned.replace(",", ".")  # Replace decimal comma
        else:
            # US: 1,500,000.00
            cleaned = cleaned.replace(",", "")   # Remove thousands commas
    elif has_comma and not has_dot:
        # "1500000,00" — comma is decimal (Indonesian)
        cleaned = cleaned.replace(",", ".")
    elif has_dot and not has_comma:
        # Could be "1500000.50" (decimal dot) or "1.500.000" (thousands dots)
        # Check if there are multiple dots → Indonesian thousands separator
        if cleaned.count(".") > 1:
            cleaned = cleaned.replace(".", "")
        # Single dot is decimal — keep it

    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


# ═══════════════════════════════════════════════
# Main extraction function
# ═══════════════════════════════════════════════

def extract_invoice(
    image_paths: list[Path],
    client: Optional[Anthropic] = None,
    max_retries: int = 3,
) -> ExtractedInvoice:
    """Extract structured invoice data from one or more page images.

    This is the primary entrypoint for the extraction pipeline. It sends
    all pages of a single invoice to Claude Sonnet 4 in one request so
    the model sees the full context (multi-page tables, continuation pages).

    Args:
        image_paths: Ordered list of image paths (one per page) for one invoice.
        client: An initialized Anthropic client. Creates one from settings if None.
        max_retries: Retry attempts on API errors or parse failures.

    Returns:
        An ExtractedInvoice with all discovered fields.

    Raises:
        RuntimeError: If extraction fails after all retries.
        ValueError: If image_paths is empty.
    """
    if not image_paths:
        raise ValueError("At least one image path is required")

    if client is None:
        client = Anthropic(api_key=settings.anthropic_api_key)

    # Build the user message: instruction text + all page images
    content: list[dict] = [
        {
            "type": "text",
            "text": (
                "Extract the invoice data from the following page image(s). "
                f"This invoice has {len(image_paths)} page(s). "
                "Combine information across ALL pages. "
                "If line items span multiple pages, merge them into one array. "
                "Return ONLY valid JSON matching the exact schema — no other text."
            ),
        }
    ]

    for img_path in image_paths:
        b64_data, media_type = _image_to_base64(img_path)
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": b64_data,
            },
        })

    last_error: Optional[Exception] = None

    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": content}],
            )

            # Assemble text from response content blocks
            raw_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    raw_text += block.text
                elif block.type == "text":
                    raw_text += block.text

            raw_dict = _parse_claude_response(raw_text)
            return _normalize_extracted(raw_dict)

        except RateLimitError as exc:
            last_error = exc
            if attempt < max_retries - 1:
                wait = (2 ** attempt) * 1.5  # 1.5s, 3s, 6s
                time.sleep(wait)
            continue

        except APIStatusError as exc:
            # Non-rate-limit API errors (500, 502, 503, etc.)
            last_error = exc
            if attempt < max_retries - 1 and exc.status_code >= 500:
                wait = (2 ** attempt) * 2
                time.sleep(wait)
            else:
                raise

        except (json.JSONDecodeError, ValueError, KeyError) as exc:
            # Parse failures — retry (Claude might output clean JSON next time)
            last_error = exc
            if attempt < max_retries - 1:
                time.sleep(0.5)
            continue

    raise RuntimeError(
        f"Failed to extract invoice from {len(image_paths)} page(s) "
        f"after {max_retries} attempts. "
        f"Last error: {last_error}"
    )
