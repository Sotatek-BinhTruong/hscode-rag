# Phase 02: Hono Worker Query API

## Overview

- **Priority:** High
- **Status:** pending
- **Depends on:** Phase 01 (Vectorize index must be populated)
- **Goal:** Hono app on Cloudflare Workers — embed user query → Vectorize semantic search → Gemini RAG answer with citations.

## Key Insights

- Hono bindings accessed via `c.env.VECTORIZE` typed with `VectorizeIndex`
- `@google/generative-ai` is fetch-based → works in Workers (no Node.js APIs used)
- Vectorize query returns `VectorizeMatches` with `metadata` payload
- Workers `compatibility_flags = ["nodejs_compat"]` needed for some npm packages
- `GEMINI_API_KEY` must be set as Worker secret (not in wrangler.toml)
- CORS headers required for frontend at different origin (Cloudflare Pages)

## Files Created in This Phase

```
worker/
├── src/
│   ├── index.ts                    # Hono app entry, routes, CORS
│   ├── routes/
│   │   └── query-route.ts          # POST /query handler
│   └── services/
│       ├── gemini-embed-service.ts  # embed query text
│       ├── vectorize-search-service.ts  # search Vectorize
│       ├── context-assembler.ts     # build RAG context + citations
│       └── gemini-generate-service.ts   # LLM answer generation
└── package.json
```

## Implementation Steps

### Step 1 — Install dependencies

```bash
cd worker
npm install hono @google/generative-ai
npm install -D @cloudflare/workers-types wrangler typescript
```

`worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

### Step 2 — Type definitions for bindings

In `worker/src/index.ts`:
```typescript
export type Bindings = {
  VECTORIZE: VectorizeIndex
  GEMINI_API_KEY: string
}
```

### Step 3 — gemini-embed-service.ts

```typescript
// worker/src/services/gemini-embed-service.ts
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({ model: 'gemini-embedding-001' })
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    taskType: 'RETRIEVAL_QUERY',  // different from RETRIEVAL_DOCUMENT
    outputDimensionality: 768,
  })
  return result.embedding.values
}
```

### Step 4 — vectorize-search-service.ts

```typescript
// worker/src/services/vectorize-search-service.ts
export interface SearchResult {
  id: string
  score: number
  document: string
  chapterNum: number
  pageNum: number
  hsCodes: string[]
  heading: string
  text: string
}

export async function searchVectorize(
  vectorize: VectorizeIndex,
  embedding: number[],
  topK = 5
): Promise<SearchResult[]> {
  const results = await vectorize.query(embedding, {
    topK,
    returnMetadata: 'all',
  })

  return results.matches.map(match => ({
    id: match.id,
    score: match.score,
    document: String(match.metadata?.document ?? ''),
    chapterNum: Number(match.metadata?.chapterNum ?? 0),
    pageNum: Number(match.metadata?.pageNum ?? 0),
    hsCodes: String(match.metadata?.hsCodes ?? '').split(',').filter(Boolean),
    heading: String(match.metadata?.heading ?? ''),
    text: String(match.metadata?.text ?? ''),
  }))
}
```

### Step 5 — context-assembler.ts

```typescript
// worker/src/services/context-assembler.ts
import type { SearchResult } from './vectorize-search-service.ts'

export interface Citation {
  document: string
  chapterNum: number
  pageNum: number
  heading: string
  hsCodes: string[]
  score: number
}

export function assembleContext(results: SearchResult[]): {
  contextText: string
  citations: Citation[]
} {
  const citations: Citation[] = []
  const blocks: string[] = []

  for (const r of results) {
    blocks.push(
      `[Source: ${r.document}, Page ${r.pageNum}${r.heading ? `, Section: ${r.heading}` : ''}]\n` +
      (r.hsCodes.length ? `HS Codes: ${r.hsCodes.join(', ')}\n` : '') +
      r.text
    )
    citations.push({
      document: r.document,
      chapterNum: r.chapterNum,
      pageNum: r.pageNum,
      heading: r.heading,
      hsCodes: r.hsCodes,
      score: r.score,
    })
  }

  return { contextText: blocks.join('\n\n---\n\n'), citations }
}
```

### Step 6 — gemini-generate-service.ts

```typescript
// worker/src/services/gemini-generate-service.ts
import { GoogleGenerativeAI } from '@google/generative-ai'

const SYSTEM_PROMPT = `You are an expert on ASEAN Harmonized Tariff Nomenclature (HSCode).
Answer questions based ONLY on the provided context.
Always cite your sources using the format: [Document, Page N, Section: NAME].
If the answer is not in the context, say so clearly.
When listing HS codes, use the exact format from the context (e.g., 0102.29.11).`

export async function generateAnswer(
  query: string,
  contextText: string,
  apiKey: string
): Promise<string> {
  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `${SYSTEM_PROMPT}\n\n## Context\n${contextText}\n\n## Question\n${query}`

  const result = await model.generateContent(prompt)
  return result.response.text()
}
```

### Step 7 — query-route.ts

```typescript
// worker/src/routes/query-route.ts
import { Hono } from 'hono'
import type { Bindings } from '../index.ts'
import { embedQuery } from '../services/gemini-embed-service.ts'
import { searchVectorize } from '../services/vectorize-search-service.ts'
import { assembleContext } from '../services/context-assembler.ts'
import { generateAnswer } from '../services/gemini-generate-service.ts'

export const queryRoute = new Hono<{ Bindings: Bindings }>()

queryRoute.post('/', async (c) => {
  const body = await c.req.json<{ query: string }>()
  if (!body.query?.trim()) {
    return c.json({ error: 'query is required' }, 400)
  }

  const embedding = await embedQuery(body.query, c.env.GEMINI_API_KEY)
  const results = await searchVectorize(c.env.VECTORIZE, embedding, 5)
  const { contextText, citations } = assembleContext(results)
  const answer = await generateAnswer(body.query, contextText, c.env.GEMINI_API_KEY)

  return c.json({ answer, citations })
})
```

### Step 8 — index.ts (main entry)

```typescript
// worker/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { queryRoute } from './routes/query-route.ts'

export type Bindings = {
  VECTORIZE: VectorizeIndex
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: ['http://localhost:5173', 'https://*.pages.dev'],  // Vite dev + Pages
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

app.route('/query', queryRoute)

app.get('/health', (c) => c.json({ status: 'ok' }))

export default app
```

### Step 9 — Set Worker secret & test locally

```bash
cd worker

# Set Gemini API key as secret
npx wrangler secret put GEMINI_API_KEY
# (paste key when prompted)

# Local dev (wrangler dev simulates Workers + Vectorize binding)
npx wrangler dev

# Test
curl -X POST http://localhost:8787/query \
  -H 'Content-Type: application/json' \
  -d '{"query": "What is the HS code for oxen?"}'
```

Expected response:
```json
{
  "answer": "The HS code for oxen is 0102.29.11...",
  "citations": [
    {
      "document": "Chapter01.pdf",
      "chapterNum": 1,
      "pageNum": 1,
      "heading": "OXEN",
      "hsCodes": ["0102.29.11"],
      "score": 0.92
    }
  ]
}
```

## API Contract

```
POST /query
Content-Type: application/json

Request:  { "query": string }
Response: {
  "answer": string,
  "citations": Array<{
    document: string,
    chapterNum: number,
    pageNum: number,
    heading: string,
    hsCodes: string[],
    score: number
  }>
}
```

## Todo

- [ ] `npm install hono @google/generative-ai` in worker/
- [ ] Configure tsconfig.json with `@cloudflare/workers-types`
- [ ] Implement `gemini-embed-service.ts`
- [ ] Implement `vectorize-search-service.ts`
- [ ] Implement `context-assembler.ts`
- [ ] Implement `gemini-generate-service.ts`
- [ ] Implement `query-route.ts`
- [ ] Implement `index.ts` with CORS
- [ ] `wrangler secret put GEMINI_API_KEY`
- [ ] `wrangler dev` local test with curl
- [ ] Verify citation output matches API contract

## Success Criteria

- `POST /query` returns `{ answer, citations }` with correct document/page/HS code references
- Query "HS code for oxen" returns citation pointing to `Chapter01.pdf, Page 1, OXEN`
- CORS allows requests from `localhost:5173`

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `@google/generative-ai` uses Node.js crypto in Workers | Use `compatibility_flags = ["nodejs_compat"]` |
| Vectorize `returnMetadata: 'all'` returns raw strings | Cast all metadata fields explicitly in `searchVectorize` |
| CORS misconfiguration blocks frontend | Test with curl first, then browser |
