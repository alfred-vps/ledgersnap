# ADR-0001: Next.js + FastAPI Monorepo Architecture

**Status:** Accepted
**Date:** 2026-05-25
**Deciders:** Alfred

## Context

LedgerSnap needs two distinct runtime environments:

1. **Web frontend** — drag-and-drop upload, results table with inline editing, job progress, CSV download
2. **PDF processing backend** — PDF → image conversion (system-level poppler dependency), Claude Vision API calls, CSV compilation

These have fundamentally different runtime requirements:
- Frontend: Node.js, npm ecosystem, best-in-class for interactive UIs
- Backend: Python, poppler-utils system dependency, heavy I/O processing

We also need to deploy to production (Fly.io recommended) and support local development.

## Decision Drivers

- **UI interactivity** — drag-and-drop file upload + inline table editing is best served by React/Next.js
- **System dependency** — pdf2image requires `poppler-utils` at the OS level, which is trivially handled in a Docker container
- **Deployment simplicity** — a single `docker-compose up` should start both services for local dev
- **Fly.io compatibility** — Fly.io supports multi-process apps and Docker deployments

## Considered Options

### Option 1: Monorepo — Next.js frontend + FastAPI backend
- **Pros:** Best-of-breed for each concern (Next.js for UI, FastAPI for processing), independent scaling, clear separation, can use Fly.io Machines for each service
- **Cons:** Two Dockerfiles, two deployments to coordinate, inter-service communication over HTTP

### Option 2: Single Next.js API-only app (Bun/Node Python bridge)
- **Pros:** Single deployment
- **Cons:** Python-in-Node bridges are brittle (child_process, wasm), poor error handling, impossible to debug, no proper dependency management

### Option 3: Pure Python backend (FastAPI + Jinja2 templates)
- **Pros:** Single language, single deployment
- **Cons:** No component architecture for drag-and-drop or interactive tables without heavy JS — defeats the purpose of the frontend pivot

## Decision

Adopt **Option 1: Monorepo with Next.js (frontend) + FastAPI (backend).**

Both services live in the same git repository under `frontend/` and `backend/`, share CI and versioning, but deploy as separate Fly.io Machines (or services in a single Fly app).

```
ledgersnap/
├── frontend/          ← Next.js App Router, TypeScript, Tailwind CSS
├── backend/           ← Python FastAPI, pdf2image, Anthropic SDK
├── docker-compose.yml ← Local development
├── fly.toml           ← Fly.io deployment config
└── .github/           ← Shared CI
```

### Communication Protocol

Frontend ← HTTP JSON REST API → Backend

- `POST /api/jobs` — upload PDFs, create processing job
- `GET /api/jobs/:id` — poll job status and results
- `GET /api/jobs/:id/download` — download compiled CSV
- `PUT /api/jobs/:id/results/:file_id` — update corrected field values

## Consequences

### Positive
- Each service uses its best ecosystem (React components, Python PDF libraries)
- Frontend can be developed and tested independently with mock API responses
- Backend can be tested with curl/httpie without the frontend running
- Future: swap FastAPI for a different backend without touching the frontend

### Negative
- Need to run two dev servers (`npm run dev` + `uvicorn`)
- Slightly more complex deployment (two Docker images)
- Frontend needs to handle API unreachability gracefully

### Risks
- CORS configuration needed during development — mitigated by Next.js rewrites in dev mode
- API versioning — mitigated by prefixing all routes with `/api/v1`

## Implementation Notes

- Frontend proxies `/api/*` to FastAPI via Next.js `rewrites` in `next.config.js`
- Backend serves on `:8000`, frontend on `:3000` in dev
- Production: frontend build output served as static files, FastAPI behind it, or both on separate Fly Machines

## References

- [Next.js App Router](https://nextjs.org/docs/app)
- [FastAPI](https://fastapi.tiangolo.com/)
- [Fly.io Docs](https://fly.io/docs/)
