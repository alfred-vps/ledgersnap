"""LedgerSnap — CSV compilation engine.

Takes one or more ExtractedInvoice results and compiles them into
a unified CSV string with consistent columns.
"""

from __future__ import annotations

import csv
import io
from typing import Optional

from .schemas import FileResult, LineItem


def compile_csv(results: list[FileResult]) -> str:
    """Compile extraction results into a single CSV string.

    Columns:
      filename, invoice_number, date, vendor_name, vendor_tax_id,
      currency, subtotal, tax_amount, grand_total, line_items_json,
      status, error

    If a result has user_corrections (from manual editing), those
    values override the extracted values.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "filename",
        "invoice_number",
        "date",
        "vendor_name",
        "vendor_tax_id",
        "currency",
        "subtotal",
        "tax_amount",
        "grand_total",
        "line_items",
        "status",
        "error",
    ])

    for fr in results:
        # Use user corrections if available, otherwise extracted data
        data = fr.user_corrections if fr.user_corrections else fr.extracted

        if data is None:
            writer.writerow([
                fr.filename,
                "", "", "", "",
                "", "", "", "",
                "",
                fr.status.value,
                fr.error or "No extraction data",
            ])
            continue

        # Serialize line items as compact JSON
        items_json = _line_items_to_csv_summary(data.line_items)

        writer.writerow([
            fr.filename,
            data.invoice_number or "",
            data.date or "",
            data.vendor_name or "",
            data.vendor_tax_id or "",
            data.currency.value,
            _fmt_num(data.subtotal),
            _fmt_num(data.tax_amount),
            _fmt_num(data.grand_total),
            items_json,
            fr.status.value,
            fr.error or "",
        ])

    return output.getvalue()


def _line_items_to_csv_summary(items: list[LineItem]) -> str:
    """Format line items as a compact string for CSV.

    For 1-2 items: show full details
    For 3+ items: show count + first item + total value
    """
    if not items:
        return ""

    import json
    # Keep it simple: JSON-serialize the items array
    return json.dumps(
        [
            {
                "desc": i.description,
                "qty": i.quantity,
                "price": i.unit_price,
                "total": i.total,
            }
            for i in items
        ],
        ensure_ascii=False,
    )


def _fmt_num(val: Optional[float]) -> str:
    """Format a number for CSV output."""
    if val is None:
        return ""
    if val == int(val):
        return str(int(val))
    return f"{val:.2f}"
