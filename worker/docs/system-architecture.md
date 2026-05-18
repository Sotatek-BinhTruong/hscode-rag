# System Architecture

HSCode RAG is a Q&A system for ASEAN Harmonized Tariff Nomenclature (HS Code) lookup using PageIndex-based Retrieval-Augmented Generation. This document describes the system components, data flow, and architectural decisions.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       User Interface                             │
│                  (React + Vite frontend)                         │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP Request
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker                            │
│                    (Hono API Server)                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  POST /query Handler                                     │   │
│  │  1. Receive query                                        │   │
│  │  2. Embed query → 768-dim vector                         │   │
│  │  3. Search Vectorize (top-5 results)                     │   │
│  │  4. Assemble context                                     │   │
│  │  5. Generate answer with citations                       │   │
│  │  6. Return { answer, citations[] }                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└──┬───────────────────────┬──────────────────────────┬────────────┘
   │                       │                          │
   │                       │                          │
   ▼                       ▼                          ▼
┌─────────────┐  ┌─────────────────┐     ┌──────────────────┐
│  Workers AI │  │ Cloudflare      │     │  Source PDFs     │
│  bge-base-  │  │ Vectorize       │     │  (Ingestion      │
│  en-v1.5    │  │ (Vector DB)     │     │   input only)    │
│  (768 dims) │  │                 │     │                  │
└─────────────┘  └─────────────────┘     └──────────────────┘
                        ▲
                        │ Indexed vectors
                        │ (from ingestion)
┌───────────────────────┴─────────────────────────────────────────┐
│                   Data Ingestion Pipeline                        │
│                   (Node.js TypeScript CLI)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  1. pdf-page-parser → Extract text from PDF pages        │   │
│  │  2. page-indexer → Extract HS codes, headings, metadata  │   │
│  │  3. Workers AI REST API → Embed PageIndex nodes (768-dim)│   │
│  │  4. vectorize-uploader → Upload vectors to Vectorize    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **API Server** | Hono 4.x on Cloudflare Workers |
| **Vector DB** | Cloudflare Vectorize (cosine similarity) |
| **Embeddings** | Cloudflare Workers AI `@cf/baai/bge-base-en-v1.5` (768 dims) |
| **LLM Generation** | Cloudflare Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| **Frontend** | React 19 + Vite + Tailwind |
| **Ingestion CLI** | TypeScript + Node.js |

## PageIndex Design

Each PDF page is indexed as a single semantic unit (node) rather than being split by token count. This preserves document structure and allows precise citation by page.

### PageIndexNode Structure

```typescript
interface PageIndexNode {
  id: string              // e.g. "chapter01-p1"
  document: string        // e.g. "Chapter01.pdf"
  chapterNum: number      // Chapter number (0 for Introduction)
  pageNum: number         // Page number (1-indexed)
  hsCodes: string[]       // Extracted HS codes, e.g. ["0102.29.11"]
  heading: string         // Page heading extracted from content
  text: string            // Full page text for embedding
}
```

### HS Code Extraction

- **Regex pattern:** `/\b\d{4}\.\d{2}(?:\.\d{2})?\b/g`
- **Formats matched:** `0102.29` (6-digit) or `0102.29.11` (8-digit)
- **Continuation pages:** Pages with no HS codes inherit codes from the previous page with codes

### Heading Extraction

1. Extract ALL-CAPS lines (uppercase letters, digits, spaces, punctuation)
2. Skip "CHAPTER N", page numbers, source attributions
3. Collect consecutive ALL-CAPS lines (max 3)
4. Fallback: first HS code or "UNKNOWN"

## Query Flow

### Step 1: Embedding
- User submits question via POST /query
- `embedQuery()` calls Workers AI `@cf/baai/bge-base-en-v1.5` via the `AI` binding
- Returns 768-dimensional vector matching Vectorize index dimensions

### Step 2: Vector Search
- `searchVectorize()` queries Vectorize index with embedding
- Retrieves top-5 most similar PageIndex nodes using cosine similarity
- Returns `SearchResult[]` with metadata: document, chapter, page, HS codes, heading, text, similarity score

### Step 3: Context Assembly
- `assembleContext()` builds prompt context from search results
- Formats each result as: `[N] Document, Page X — Heading\nHS Codes: ...\nText...`
- Joins results with separator: `\n\n---\n\n`
- Returns both context text and citation metadata

### Step 4: LLM Generation
- `generateAnswer()` calls Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via the `AI` binding
- System prompt enforces:
  - Answer ONLY from provided context
  - Cite sources using format from context: `[1] Chapter01.pdf, Page 1 — OXEN`
  - Use exact HS code format from documents
  - Decline if information not in context
- Max output: 1024 tokens

### Step 5: Response
- Return JSON: `{ answer: string, citations: Citation[] }`
- Each citation includes: document, chapter, page, heading, HS codes, similarity score

## Core Services

### 1. `workers-ai-embed-service.ts`
- Embeds queries using Workers AI `@cf/baai/bge-base-en-v1.5` via the `AI` binding
- Input: query string + `Ai` binding
- Output: 768-dim float vector
- Called on every query request

### 3. `vectorize-search-service.ts`
- Queries Cloudflare Vectorize index using pre-computed embedding
- Parameters:
  - `vectorize`: VectorizeIndex binding
  - `embedding`: 768-dim vector from embedding service
  - `topK`: number of results to return (default 5)
- Returns: `SearchResult[]` with metadata (document, chapter, page, HS codes, heading, text, score)

### 4. `context-assembler.ts`
- Transforms raw `SearchResult[]` into prompt context
- Formats results as numbered sources with metadata
- Produces citation metadata array for response
- Input: `SearchResult[]` from vector search
- Output: `{ contextText: string, citations: Citation[] }`

### 5. `workers-ai-generate-service.ts`
- Generates RAG answer using Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- System prompt enforces citation rules and accuracy constraints
- Parameters:
  - `query`: user's original question
  - `contextText`: assembled context from search results
  - `ai`: Cloudflare `Ai` binding
- Returns: answer string with inline citations

## API Reference

### POST /query

**Request:**
```json
{
  "query": "What is the HS code for live oxen?"
}
```

**Response:**
```json
{
  "answer": "The HS code for live oxen is 0102.29.11 [1]. This falls under Chapter 01 covering live animals.",
  "citations": [
    {
      "document": "Chapter01.pdf",
      "chapterNum": 1,
      "pageNum": 1,
      "heading": "OXEN",
      "hsCodes": ["0102.29.11"],
      "score": 0.687
    }
  ]
}
```

**Error Responses:**
- `400 Bad Request`: Missing or empty `query` field, invalid JSON
- `500 Internal Server Error`: Service failure (embedding, search, or generation)

### GET /health

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1234567890
}
```

## CORS Policy

Access is allowed from:
- `http://localhost:*` (local development with Vite dev server)
- `*.pages.dev` (Cloudflare Pages deployments)
- All methods: POST, GET, OPTIONS
- All headers allowed
- Max age: 86400 seconds (24 hours)

## Configuration Reference

### wrangler.toml (worker/)

```toml
name = "hscode-rag-worker"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]
account_id = "..."

[[vectorize]]
binding = "VECTORIZE"
index_name = "hscode-rag-index"

[ai]
binding = "AI"
```

**Bindings:**
- `VECTORIZE`: Cloudflare Vectorize index (cosine similarity, 768 dimensions)
- `AI`: Cloudflare Workers AI runtime (used for both embedding and generation)

### Environment Variables (scripts/.env)

```
CF_ACCOUNT_ID=<cloudflare-account-id>
CF_API_TOKEN=<api-token-with-workers-ai-and-vectorize-permissions>
CF_VECTORIZE_INDEX=hscode-rag-index
```

## Known Constraints

- **Vectorize free tier:** Max 200,000 vectors, 1500 char metadata limit
- **Embedding context:** ~512 token limit, page text truncated to ~2000 chars before embedding
- **Rate limiting:** 100ms delay between embed calls during ingestion
- **Batch upload:** Vectorize upsert in batches of 100 vectors
- **Generation max tokens:** 1024 per response
- **Search results:** Top-5 results returned by default

## Deployment Architecture

The system is deployed across Cloudflare edge infrastructure:

- **Worker API**: `https://hscode-rag-worker.<account>.workers.dev`
- **Frontend Pages**: GitHub → Cloudflare Pages auto-deploy
- **Vector Database**: Cloudflare Vectorize (global edge)
- **AI Services**: Cloudflare Workers AI (embedded in Worker runtime, no external calls)

All components are integrated via standard HTTP/REST APIs, enabling zero-downtime updates and edge-based inference.
