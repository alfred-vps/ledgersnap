# LedgerSnap — SaaS Architecture (Cloudflare-Native)

## Overview

LedgerSnap is a fully client-side web app with a thin Cloudflare Worker backend.
All PDF processing happens in the browser. The Worker is a stateless proxy to
the Anthropic API.

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Browser (User)                      │
│                                                      │
│  ① Drop PDFs                                         │
│      ↓                                               │
│  ② pdf.js renders each page to canvas                 │
│      ↓                                               │
│  ③ Canvas → JPEG base64                              │
│      ↓                                               │
│  ④ POST / (base64 images)                            │
│      ↓                                               │
│  ⑤ Display results table                              │
│  ⑥ Download CSV (compiled client-side)               │
│                                                      │
└──────────────────┬──────────────────────────────────┘
                   │ HTTPS
                   ▼
┌──────────────────────────────────────────────────────┐
│           Cloudflare Worker (workers.dev)             │
│                                                       │
│  / → receives images → calls Anthropic API             │
│     → returns structured JSON                          │
│                                                       │
│  Environment: ANTHROPIC_API_KEY (via wrangler secret) │
└──────────────────────────────────────────────────────┘
                   │ HTTPS
                   ▼
┌──────────────────────────────────────────────────────┐
│           Anthropic API (Claude Sonnet 4)             │
│                                                       │
│  Invoice extraction from image data                    │
└──────────────────────────────────────────────────────┘
```

## Data Flow

### Single Processing Cycle (per PDF)

1. **PDF Rendering** (browser, pdf.js)
   - Load PDF using pdfjs-dist
   - Render each page to OffscreenCanvas at 1600px max width
   - Export as JPEG (quality 0.8) → base64 string
   - Cap: 20 pages max (configurable)

2. **Extraction** (Cloudflare Worker)
   - Receive POST with `{ images: string[] }`
   - Forward to Anthropic Claude Sonnet 4 with the extraction prompt
   - Return `{ success: boolean, data: ExtractedInvoice }`
   - Worker is stateless — scales to zero when not in use

3. **Display & Export** (browser)
   - Show results in a table
   - User reviews inline
   - Click "Download CSV" → compiled client-side → browser download

## Components

### Frontend — Next.js → Cloudflare Pages

- **Static export** via `next.config.js` → `output: 'export'`
- Deployed to Cloudflare Pages via `wrangler pages deploy`
- No server-side rendering — all JS runs in the browser
- pdf.js handles all PDF rendering

### Worker — Cloudflare Workers

- Single endpoint: `POST /`
- Thin proxy to Anthropic API
- No database, no queue, no persistence
- CORS enabled for Cloudflare Pages origin

## Deployment

```bash
# 1. Deploy Worker
cd worker
npm install
wrangler deploy

# 2. Set secret API key
wrangler secret put ANTHROPIC_API_KEY

# 3. Build and deploy frontend
cd frontend
npm install
npm run build
npx wrangler pages deploy out/ --project-name ledgersnap

# Or: link to git repo for auto-deploy on push
```

## Key Differences from Server-Based Architecture

| Aspect | Old (FastAPI + Fly.io) | New (Cloudflare Native) |
|--------|----------------------|------------------------|
| PDF rendering | Server-side (poppler) | Client-side (pdf.js) |
| Backend | Python FastAPI (full app) | TypeScript Worker (~100 lines) |
| State | SQLite + in-memory queue | None (ephemeral browser state) |
| Deployment | Docker + Flyctl | wrangler deploy |
| System deps | poppler-utils required | Zero system dependencies |
| Cost | $0.50-2/mo hosting | $0 hosting (free tier) |
| Scaling | Manual (Fly Machine) | Auto-scaling (Workers) |

## Security

- **No user data stored** — everything stays in the browser or is discarded after extraction
- **Anthropic API key** stored as Worker secret (never exposed to client)
- **Optional client API key** — user can provide their own key via the UI header
- **CORS** — Worker restricts to Cloudflare Pages origin

## Cost Estimate

| Item | Cost |
|------|------|
| Cloudflare Pages | Free (1 build/min, unlimited bandwidth on free tier) |
| Cloudflare Workers | Free (100k requests/day) |
| Anthropic API (500 invoices, avg 2 pages) | ~$6-7/month |
| **Total** | **~$6-7/month** |
