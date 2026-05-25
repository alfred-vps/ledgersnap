# LedgerSnap — Automated PDF-to-CSV Data Extractor

**One-liner:** Drop a folder of mixed PDF invoices, get a clean CSV. No templates, no training, no fuss.

**Tagline:** Your books. Snapped clean.

## Brand Identity

- **Name:** LedgerSnap — "Ledger" (bookkeeping) + "Snap" (instant, one-click)
- **Target audience:** Indonesian SMEs — logistics companies, distributors, accounting firms
- **Pain point:** Hundreds of hours/month wasted manually copying PDF data into Excel

## Architecture (Cloudflare-Native)

```
[Browser] ← pdf.js renders PDFs → [Cloudflare Worker] → [Anthropic Claude API]
     ↓                                                                   ↓
  CSV download ← compiled client-side                        Structured JSON
```

- **Frontend:** Next.js (App Router, TypeScript, Tailwind CSS) — static export on Cloudflare Pages
- **API:** Cloudflare Worker — thin proxy to Anthropic Claude Sonnet 4 Vision
- **PDF rendering:** Client-side via pdf.js → OffscreenCanvas → JPEG base64
- **State:** None — all ephemeral in the browser tab
- **Deployment:** `wrangler deploy` (Worker) + `wrangler pages deploy` (Frontend)

## Features (MVP)

1. **Drag-and-drop upload** — drop PDFs, see them queued
2. **Auto-extraction** — Invoice #, Date, Grand Total, Line Items, Vendor Name, Tax ID
3. **Results table** — see extracted data per file
4. **Export** — download as .csv (compiled client-side)
5. **Batch processing** — render + extract 10-50 PDFs sequentially

## Key Decisions

- **Extraction engine:** Claude Sonnet 4 Vision — layout-agnostic, handles BI/EN, ~$0.002-0.015/page
- **Frontend framework:** Next.js App Router + TypeScript + Tailwind CSS (static export)
- **API layer:** Cloudflare Worker (zero infra, auto-scaling)
- **No backend server** — all PDF processing is client-side

## Current Status

**Phase 3 (Plan)** — Architecture re-decided for Cloudflare-native.
**Phase 4 (Build)** — All code written. Ready to deploy.
