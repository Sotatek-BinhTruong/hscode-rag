# Phase 01: Project Setup & Ingestion Pipeline

## Overview

- **Priority:** High (blocker for all other phases)
- **Status:** pending
- **Goal:** Scaffold monorepo, parse all 61 PDF pages into PageIndex nodes, embed with Gemini, push to Cloudflare Vectorize.

## Key Insights

- 61 total pages across 11 chapters + Introduction (confirmed via `pdfinfo`)
- `pdftotext -f {page} -l {page}` extracts single-page text reliably
- Some pages have 0 HS codes (continuation pages) → inherit last seen HS codes
- HS code regex: `/^\d{4}\.\d{2}(?:\.\d{2})?/gm` — matches `0102.29` and `0102.29.11`
- Heading = first ALL-CAPS line after HS code block
- Gemini `text-embedding-004` is **deprecated** (Jan 2026) → use `gemini-embedding-001`
- Use `outputDimensionality: 768` → fits Vectorize max 1536, good quality/speed tradeoff
- Cloudflare Vectorize insert endpoint: `POST /accounts/{id}/vectorize/v2/indexes/{name}/insert`

## Requirements

- Node.js >= 18 (for native fetch)
- `pdftotext` available on system (already confirmed)
- Cloudflare account with Vectorize enabled (free tier)
- Gemini API key

## Project Structure Created in This Phase

```
hscode-rag/
├── package.json              # Root workspace (npm workspaces)
├── .env.example
├── worker/
│   ├── package.json
│   ├── wrangler.toml
│   ├── tsconfig.json
│   └── src/
│       └── index.ts          # Placeholder, filled in Phase 02
├── frontend/
│   └── package.json          # Placeholder, scaffolded in Phase 03
└── scripts/
    ├── package.json
    ├── tsconfig.json
    ├── .env                  # CF_ACCOUNT_ID, CF_API_TOKEN, GEMINI_API_KEY
    ├── ingest.ts             # Main CLI entry point
    ├── pdf-page-parser.ts    # pdftotext → raw pages
    ├── page-indexer.ts       # HS code + heading extraction, continuation handling
    └── vectorize-uploader.ts # Cloudflare Vectorize REST API upload
```

## Implementation Steps

### Step 1 — Root workspace

```bash
# In /home/sotatek/Workspace/hscode-rag/
npm init -y
```

`package.json`:
```json
{
  "name": "hscode-rag",
  "private": true,
  "workspaces": ["worker", "frontend", "scripts"]
}
```

### Step 2 — Cloudflare Vectorize index creation

```bash
cd worker
npm create cloudflare@latest . -- --type=hello-world --ts
# Accept defaults, do NOT deploy yet

# Create the vector index (768 dims, cosine similarity)
npx wrangler vectorize create hscode-rag-index --dimensions=768 --metric=cosine
```

`wrangler.toml`:
```toml
name = "hscode-rag-worker"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[vectorize]]
binding = "VECTORIZE"
index_name = "hscode-rag-index"

# GEMINI_API_KEY set via: wrangler secret put GEMINI_API_KEY
```

### Step 3 — Scripts package setup

```bash
cd scripts
npm init -y
npm install tsx dotenv @google/generative-ai
npm install -D typescript @types/node
```

`scripts/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist"
  }
}
```

### Step 4 — pdf-page-parser.ts

Extracts text per page using `pdftotext`:

```typescript
// scripts/pdf-page-parser.ts
import { execSync } from 'child_process'

export interface RawPage {
  filePath: string
  fileName: string
  pageNum: number   // 1-indexed, physical page in PDF
  text: string
}

export function parseAllPages(filePath: string): RawPage[] {
  const fileName = path.basename(filePath)
  const totalPages = getPdfPageCount(filePath)
  const pages: RawPage[] = []

  for (let p = 1; p <= totalPages; p++) {
    const text = execSync(
      `pdftotext -f ${p} -l ${p} "${filePath}" -`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    ).trim()
    pages.push({ filePath, fileName, pageNum: p, text })
  }
  return pages
}

function getPdfPageCount(filePath: string): number {
  const info = execSync(`pdfinfo "${filePath}"`, { encoding: 'utf-8' })
  const match = info.match(/Pages:\s+(\d+)/)
  return match ? parseInt(match[1]) : 0
}
```

### Step 5 — page-indexer.ts

Builds PageIndex nodes with metadata extraction:

```typescript
// scripts/page-indexer.ts
export interface PageIndexNode {
  id: string           // "chapter01-p1"
  document: string     // "Chapter01.pdf"
  chapterNum: number   // 0 for Introduction
  pageNum: number
  hsCodes: string[]    // ["0102.29.11", "0102.29.12"]
  heading: string      // "OXEN"
  text: string         // full page text (used for embedding)
}

const HS_CODE_REGEX = /^\d{4}\.\d{2}(?:\.\d{2})?/gm
const CHAPTER_REGEX = /^CHAPTER\s+(\d+)/m
const ALL_CAPS_HEADING = /^[A-Z][A-Z\s,;()\/\-–]{5,}$/m

export function buildPageIndex(rawPages: RawPage[]): PageIndexNode[] {
  const nodes: PageIndexNode[] = []
  let lastHsCodes: string[] = []

  for (const page of rawPages) {
    const hsCodes = extractHsCodes(page.text)
    const chapterNum = extractChapterNum(page.fileName)

    // Continuation page: inherit previous HS codes
    const effectiveHsCodes = hsCodes.length > 0 ? hsCodes : [...lastHsCodes]
    if (hsCodes.length > 0) lastHsCodes = hsCodes

    const heading = extractHeading(page.text, hsCodes)

    nodes.push({
      id: buildId(page.fileName, page.pageNum),
      document: page.fileName,
      chapterNum,
      pageNum: page.pageNum,
      hsCodes: effectiveHsCodes,
      heading,
      text: page.text,
    })
  }
  return nodes
}

function extractHsCodes(text: string): string[] {
  return [...new Set([...text.matchAll(HS_CODE_REGEX)].map(m => m[0]))]
}

function extractHeading(text: string, hsCodes: string[]): string {
  // Find first ALL-CAPS line that is not a HS code
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (ALL_CAPS_HEADING.test(trimmed) && !HS_CODE_REGEX.test(trimmed)) {
      return trimmed.slice(0, 120)
    }
  }
  return hsCodes[0] ?? 'UNKNOWN'
}

function extractChapterNum(fileName: string): number {
  const m = fileName.match(/Chapter(\d+)/i)
  return m ? parseInt(m[1]) : 0
}

function buildId(fileName: string, pageNum: number): string {
  return fileName.replace('.pdf', '').toLowerCase().replace(/\s+/g, '') + `-p${pageNum}`
}
```

### Step 6 — vectorize-uploader.ts

Uploads vectors to Cloudflare Vectorize via REST API:

```typescript
// scripts/vectorize-uploader.ts
// Cloudflare Vectorize REST API: v2 NDJSON insert format
// POST /accounts/{id}/vectorize/v2/indexes/{name}/insert

export async function uploadToVectorize(
  nodes: PageIndexNode[],
  embeddings: number[][],
  config: { accountId: string; apiToken: string; indexName: string }
) {
  const BATCH_SIZE = 100  // Vectorize insert batch limit

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE)
    const batchEmbeds = embeddings.slice(i, i + BATCH_SIZE)

    // NDJSON format required by Vectorize v2
    const ndjson = batch.map((node, j) => JSON.stringify({
      id: node.id,
      values: batchEmbeds[j],
      metadata: {
        document: node.document,
        chapterNum: node.chapterNum,
        pageNum: node.pageNum,
        hsCodes: node.hsCodes.join(','),
        heading: node.heading,
        text: node.text.slice(0, 1000),  // metadata size limit
      }
    })).join('\n')

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/vectorize/v2/indexes/${config.indexName}/insert`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      }
    )
    if (!res.ok) throw new Error(`Vectorize insert failed: ${await res.text()}`)
    console.log(`Inserted batch ${i + 1}–${i + batch.length}`)
  }
}
```

### Step 7 — ingest.ts (main CLI)

```typescript
// scripts/ingest.ts
import 'dotenv/config'
import path from 'path'
import glob from 'node:fs'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { parseAllPages } from './pdf-page-parser.ts'
import { buildPageIndex } from './page-indexer.ts'
import { uploadToVectorize } from './vectorize-uploader.ts'

const DATASET_DIR = path.resolve('../dataset')
const EMBED_DELAY_MS = 200  // Rate limit guard: ~5 req/s

async function main() {
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const embeddingModel = genai.getGenerativeModel({ model: 'gemini-embedding-001' })

  // 1. Parse all PDFs
  const pdfFiles = fs.readdirSync(DATASET_DIR)
    .filter(f => f.endsWith('.pdf'))
    .sort()
    .map(f => path.join(DATASET_DIR, f))

  const allRawPages = pdfFiles.flatMap(parseAllPages)
  console.log(`Parsed ${allRawPages.length} pages`)

  // 2. Build PageIndex
  const nodes = buildPageIndex(allRawPages)
  console.log(`Built ${nodes.length} PageIndex nodes`)

  // 3. Embed each node
  const embeddings: number[][] = []
  for (const node of nodes) {
    const result = await embeddingModel.embedContent({
      content: { parts: [{ text: node.text }], role: 'user' },
      taskType: 'RETRIEVAL_DOCUMENT',
      title: node.heading,
      outputDimensionality: 768,
    })
    embeddings.push(result.embedding.values)
    await sleep(EMBED_DELAY_MS)
    process.stdout.write(`\rEmbedded ${embeddings.length}/${nodes.length}`)
  }
  console.log('\nAll embeddings ready')

  // 4. Upload to Vectorize
  await uploadToVectorize(nodes, embeddings, {
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
    indexName: process.env.CF_VECTORIZE_INDEX!,
  })
  console.log('Ingestion complete')
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
main().catch(console.error)
```

`scripts/package.json` scripts:
```json
{
  "scripts": {
    "ingest": "tsx ingest.ts"
  }
}
```

Run: `cd scripts && npm run ingest`

### Step 8 — Verify ingestion

```bash
# Check vector count via wrangler
cd worker
npx wrangler vectorize info hscode-rag-index
# Should show: vectorCount: 61
```

## Todo

- [ ] Init root workspace package.json
- [ ] `npm create cloudflare@latest` in worker/
- [ ] Create Vectorize index via `wrangler vectorize create`
- [ ] Configure wrangler.toml with Vectorize binding
- [ ] Create scripts/ with package.json + tsconfig
- [ ] Implement `pdf-page-parser.ts`
- [ ] Implement `page-indexer.ts` with HS code + heading extraction
- [ ] Implement `vectorize-uploader.ts`
- [ ] Implement `ingest.ts` orchestrator
- [ ] Create `scripts/.env` from `.env.example`
- [ ] Run ingestion: `npm run ingest`
- [ ] Verify: `wrangler vectorize info hscode-rag-index` shows 61 vectors

## Success Criteria

- `wrangler vectorize info` shows `vectorCount: 61`
- Each vector has metadata: `document`, `chapterNum`, `pageNum`, `hsCodes`, `heading`, `text`
- No embedding errors (rate limit handled by delay)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Gemini rate limit (free tier: 100 req/min) | 200ms delay between embeds = 5 req/s |
| Vectorize metadata size limit (10KB/vector) | Truncate `text` to 1000 chars in metadata |
| Continuation pages wrong HS code inheritance | Test with Chapter08 which has multi-page entries |
| pdftotext encoding issues | Verify UTF-8 output, add `-enc UTF-8` flag if needed |
