# ADR-0002: Pivot to Cloudflare-Native Architecture

**Status:** Accepted
**Date:** 2026-05-25
**Supersedes:** ADR-0001 (Next.js + FastAPI Monorepo)

## Context

ADR-0001 chose a two-service monorepo with Next.js (frontend) + FastAPI (backend) deployed to Fly.io. Before implementation began, we discovered:

1. Alfred has a **Cloudflare account** with an active API token
2. No Fly.io account exists
3. `wrangler` CLI installed successfully
4. Cloudflare offers Workers + Pages on a generous free tier
5. Modern browsers support pdf.js and OffscreenCanvas for client-side PDF rendering

This dramatically simplifies the architecture — no Docker, no Python backend, no poppler-utils, no SQLite, no queue. Everything can run in the browser with a thin Worker proxy.

## Decision Drivers

- **Zero infrastructure cost** — Cloudflare free tier covers MVP
- **Alfred already has Cloudflare** — no new account signup
- **Simpler deployment** — `wrangler deploy` vs Docker + Flyctl
- **No system dependencies** — poppler-utils eliminated entirely
- **Faster iteration** — change frontend = rebuild static site, no backend to update

## Considered Options

### Option 1: Cloudflare-Native (Chosen)
- **Pros:** Zero infra cost, no backend to manage, Alfred already has Cloudflare, instant deployment, scales to zero, no Docker/containers
- **Cons:** Browser does the PDF rendering (slower on old machines), no persistent state (browser tab refresh loses progress), pdf.js dependency adds bundle size

### Option 2: FastAPI + Fly.io (ADR-0001)
- **Pros:** Server-side rendering is faster, SQLite persistence, proper job queue
- **Cons:** Requires Fly.io signup, Docker knowledge, more moving parts, $0.50-2/mo cost

### Option 3: FastAPI on Cloudflare (pages functions / workers)
- **Pros:** Combines Cloudflare access with Python backend
- **Cons:** Cloudflare Workers don't run Python. Pages Functions don't support system deps (poppler). Would need WASM Python — experimental, brittle.

## Decision

Pivot to **Cloudflare-Native Architecture:**

```
Browser (pdf.js → canvas → JPEG) → Cloudflare Worker → Anthropic API
```

- **Frontend:** Next.js static export → Cloudflare Pages
- **Worker:** TypeScript proxy → Anthropic API
- **No backend server:** All PDF processing in browser

## Consequences

### Positive
- Zero hosting cost (Cloudflare free tier)
- Single `wrangler deploy` for the Worker
- `wrangler pages deploy out/` for the frontend
- No system dependencies, no containers, no databases
- Works offline after initial page load (except API calls)

### Negative
- Processing 50+ PDFs keeps the browser tab busy
- Progress is lost on tab close (no persistence)
- pdf.js adds ~2MB to the bundle
- Old machines may struggle with large PDFs

### Mitigations
- Show per-file progress so user knows what's happening
- Warn before closing tab with active processing
- Future: add Cloudflare D1 for persistence if needed

## References

- https://developers.cloudflare.com/workers/
- https://developers.cloudflare.com/pages/
- https://mozilla.github.io/pdf.js/
