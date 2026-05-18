---
title: HSCode RAG with PageIndex
status: implementation-complete
priority: high
created: 2026-05-18
blockedBy: []
blocks: []
---

# HSCode RAG with PageIndex

## Overview

Q&A system for ASEAN Harmonized Tariff Nomenclature (HSCode) using page-level indexing instead of fixed-size chunking. Each PDF page = one Vectorize point with metadata (chapter, page, HS codes, heading).

**Brainstorm report:** `plans/reports/brainstorm-260518-1542-hscode-rag-pageindex.md`

## Stack

| Layer | Tech |
|-------|------|
| PDF parsing | `pdftotext` CLI (Node.js child_process) |
| Ingestion | TypeScript CLI (Node.js) → Cloudflare Vectorize REST API |
| Backend | Hono + Cloudflare Workers (TypeScript) |
| Vector DB | Cloudflare Vectorize (free tier, 768-dim) |
| Embedding | Gemini `gemini-embedding-001` (768 dims via outputDimensionality) |
| LLM | Gemini `gemini-2.0-flash` |
| Frontend | React + Vite → Cloudflare Pages |

## Dataset

- 11 chapter PDFs + Introduction.pdf in `./dataset/`
- **61 total pages** → 61 vectors
- Some pages are continuations (no HS codes) → inherit previous page's HS codes
- HS code pattern: `/^\d{4}\.\d{2}(?:\.\d{2})?/gm`

## Phases

| Phase | Description | Status |
|-------|-------------|--------|
| [Phase 01](phase-01-project-setup-and-ingestion.md) | Project setup + ingestion pipeline CLI | ✓ done |
| [Phase 02](phase-02-worker-query-api.md) | Hono Worker query API | ✓ done |
| [Phase 03](phase-03-react-vite-frontend.md) | React + Vite chat UI | ✓ done |
| [Phase 04](phase-04-deploy.md) | Deploy to Cloudflare | ready |

## Key Architecture Decisions

- **Page = atomic unit**: No fixed-size chunking. Each page has rich metadata.
- **Continuation handling**: Pages without HS codes inherit from previous page.
- **768 dimensions**: Vectorize free tier supports up to 1536; use 768 for speed.
- **Workers-only SDK**: Use `@google/generative-ai` (fetch-based, edge-compatible).
- **Secrets**: `GEMINI_API_KEY` via `wrangler secret put`, never in wrangler.toml.

## Environment Variables

**scripts/.env** (local ingestion only):
```
CF_ACCOUNT_ID=
CF_API_TOKEN=         # Cloudflare API token with Vectorize edit permissions
GEMINI_API_KEY=
CF_VECTORIZE_INDEX=hscode-rag-index
```

**Worker secrets** (via `wrangler secret put`):
```
GEMINI_API_KEY
```
