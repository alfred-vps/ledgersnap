# Changelog

## 2026-05-25 — Cloudflare Architecture Pivot

- Pivoted from Fly.io (FastAPI + Docker) to Cloudflare-native architecture
- Created `worker/src/index.ts` — Cloudflare Worker proxy to Anthropic API
- Created `worker/wrangler.toml` — Worker configuration
- Rewrote frontend for client-side PDF processing:
  - `lib/pdf-renderer.ts` — pdf.js → canvas → JPEG base64
  - `lib/api.ts` — now calls Cloudflare Worker
  - `app/page.tsx` — full client-side flow (upload → render → extract → display → download)
- Updated `next.config.js` — static export for Cloudflare Pages
- Archived `backend/` → `.archive/backend/`
- Removed `fly.toml`, `docker-compose.yml` (no longer needed)
- ADR-0002: Pivot to Cloudflare-Native Architecture (supersedes ADR-0001)
- SAAS_ARCHITECTURE.md rewritten for CF-native design
