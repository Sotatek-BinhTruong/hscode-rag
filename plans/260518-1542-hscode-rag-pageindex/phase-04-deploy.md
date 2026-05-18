# Phase 04: Deploy to Cloudflare

## Overview

- **Priority:** Low
- **Status:** pending
- **Depends on:** Phase 02 + Phase 03 (both must pass local tests)
- **Goal:** Deploy Worker to Cloudflare Workers + frontend to Cloudflare Pages. Both free tier.

## Key Insights

- Worker deploy: `wrangler deploy` — one command, global edge
- Pages deploy: `wrangler pages deploy dist` — after `npm run build`
- `GEMINI_API_KEY` secret already set via `wrangler secret put` in Phase 02 — persists across deploys
- Frontend needs `VITE_API_URL` set to the deployed Worker URL before building
- CORS in worker `index.ts` must include the Pages domain (`*.pages.dev`)
- Cloudflare Pages auto-assigns `<project>.pages.dev` domain

## Steps

### Step 1 — Deploy Worker

```bash
cd worker
npx wrangler deploy
# Output: https://hscode-rag-worker.<account>.workers.dev
```

Note the Worker URL — needed for frontend env var.

Verify:
```bash
curl -X POST https://hscode-rag-worker.<account>.workers.dev/query \
  -H 'Content-Type: application/json' \
  -d '{"query": "What is the HS code for oxen?"}'
```

### Step 2 — Update CORS for production origin

In `worker/src/index.ts`, CORS origin already includes `*.pages.dev`.
If using a custom domain, add it to the `origin` array and redeploy.

### Step 3 — Build frontend with production API URL

```bash
cd frontend
VITE_API_URL=https://hscode-rag-worker.<account>.workers.dev npm run build
# Outputs to: frontend/dist/
```

Or create `frontend/.env.production`:
```
VITE_API_URL=https://hscode-rag-worker.<account>.workers.dev
```
Then just: `npm run build`

### Step 4 — Deploy frontend to Cloudflare Pages

```bash
# One-time: create Pages project
npx wrangler pages project create hscode-rag-frontend

# Deploy
npx wrangler pages deploy dist --project-name=hscode-rag-frontend
# Output: https://hscode-rag-frontend.pages.dev
```

### Step 5 — Smoke test production

Open `https://hscode-rag-frontend.pages.dev` and test:
- "What is the HS code for breeding carp?"
- "Tell me about coconuts classification"
- "Find HS code for limes"

Each answer should include citation cards with Chapter/Page/HS code references.

## Todo

- [ ] `wrangler deploy` — note Worker URL
- [ ] Verify Worker with curl
- [ ] Set `VITE_API_URL` and `npm run build` in frontend/
- [ ] `wrangler pages project create hscode-rag-frontend`
- [ ] `wrangler pages deploy dist`
- [ ] Smoke test 3 queries on production URL

## Success Criteria

- Worker accessible at `*.workers.dev` with correct JSON responses
- Frontend accessible at `*.pages.dev`
- Citations render correctly in production browser

## Notes

- Re-ingestion: if PDF dataset changes, re-run `cd scripts && npm run ingest`
- Secrets survive redeployment — no need to re-run `wrangler secret put`
- Free tier limits: Workers 100k req/day, Pages unlimited static requests
