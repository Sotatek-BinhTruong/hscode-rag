# HSCode RAG Codebase Summary

## Project Overview

HSCode RAG is a Q&A system for ASEAN Harmonized Tariff Nomenclature (HS Code) lookup using PageIndex-based Retrieval-Augmented Generation (RAG).

### What is PageIndex RAG?

Traditional RAG systems chunk documents by token count (512 tokens, 1000 tokens, etc.), which splits related information arbitrarily. **PageIndex RAG** instead treats each PDF page as a semantic unit:
- One page = one indexed node
- HS codes and headings extracted per page
- Continuation pages (no HS codes) inherit codes from the previous page
- Embedding preserves document structure without artificial splitting

This approach is ideal for tariff nomenclature documents where pages maintain logical grouping by HS code chapters and sections.

## Technology Stack

| Component | Technology |
|-----------|-----------|
| **API Server** | Hono 4.x on Cloudflare Workers |
| **Vector DB** | Cloudflare Vectorize |
| **Embeddings** | Cloudflare Workers AI (text-embedding-base) for query; Gemini `embedding-001` (768 dimensions) for ingestion |
| **LLM** | Cloudflare Workers AI (Llama 3.3 70B) for generation |
| **Hybrid Search** | Lexical reranking + RRF fusion (keyword match, Levenshtein fuzzy, HS code metadata boost) |
| **Frontend** | React 19 + Vite + Tailwind CSS |
| **CLI Scripts** | TypeScript + Node.js (tsx) |
| **Package Manager** | npm workspaces (monorepo) |

## Architecture Overview

```
hscode-rag (monorepo root)
├── worker/              → Cloudflare Workers API
├── frontend/            → React chat UI
├── scripts/             → Data ingestion CLI
└── dataset/             → Source PDF files
```

### Data Flow: Ingestion → Serving

```
PDF Files (dataset/)
    ↓
[pdf-page-parser.ts] Parse pages → extract text
    ↓
[page-indexer.ts] Build PageIndex nodes → extract HS codes & headings
    ↓
[contextual-text-builder.ts] Prepend [Document][Chapter][Heading][HS Codes] to raw text
    ↓
[Gemini embedding-001] Embed contextual text (768-dim vectors)
    ↓
[vectorize-uploader.ts] Upload vectors + metadata → Cloudflare Vectorize
    ↓
[worker API /query] Query flow:
    ├─ Embed query with Cloudflare Workers AI
    ├─ Vector search: topK=15 from Vectorize
    ├─ HS code detection + keyword extraction (lexical)
    ├─ Hybrid rerank: vector (0.6) + lexical + HS boost (1.0) + RRF
    ├─ Slice top-5 + dedupe + score-threshold filter
    ├─ Assemble context + citations
    └─ Generate answer with Llama 3.3 70B
    ↓
[React frontend] Display answer + citations with relevance % 
```

## Directory Structure

### `/worker` — API Backend (Cloudflare Workers)

```
worker/
├── src/
│   ├── index.ts                          # Hono app entry point
│   ├── routes/
│   │   └── query-route.ts                # POST /query handler (orchestrates search→rerank→generate)
│   └── services/
│       ├── vectorize-search-service.ts   # Vector similarity search (topK=15)
│       ├── hs-code-detector.ts           # Extract HS codes from query with regex
│       ├── keyword-search-service.ts     # Keyword extraction + fuzzy matching (EN+VI stopwords)
│       ├── reranker-service.ts           # Hybrid reranking: vector + lexical + HS boost + RRF
│       ├── context-assembler.ts          # Dedupe, filter by score threshold, build citations
│       └── workers-ai-generate-service.ts # LLM response generation (Llama 3.3, language mirroring)
├── wrangler.toml                         # Cloudflare Workers config
└── package.json
```

**Key endpoint:**
- `POST /query` — Accepts question; returns `{ answer, citations[] }` with cited HS codes and relevance %

### `/scripts` — Data Ingestion CLI

```
scripts/
├── ingest.ts                     # Main ingestion orchestrator
├── pdf-page-parser.ts            # Extract text from PDF pages
├── page-indexer.ts               # Build PageIndex nodes + extract HS codes/headings
├── contextual-text-builder.ts    # Prepend [Document][Chapter][Heading][HS Codes][Page] prefix
└── vectorize-uploader.ts         # Upload vectors + metadata to Cloudflare Vectorize
```

**Running ingestion:**
```bash
cd scripts
npm run ingest:dry    # Parse + embed only (no upload); shows sample contextual text
npm run ingest        # Full pipeline: parse → build contextual text → embed → upload
```

### `/frontend` — React Chat UI

```
frontend/
├── src/
│   ├── App.tsx               # Main chat component
│   ├── App.css               # Tailwind styles
│   └── main.tsx              # React entry point
├── vite.config.ts            # Vite bundler config
└── package.json
```

**Running locally:**
```bash
cd frontend
npm run dev       # Start dev server on http://localhost:5173
npm run build     # Production build
```

### `/dataset` — Source Documents

```
dataset/
└── *.pdf         # Tariff nomenclature PDFs (e.g., Chapter01.pdf, Chapter02.pdf)
```

Filenames must match pattern `Chapter{N}.pdf` for chapter extraction.

## Query Flow & Hybrid Search

### Updated Query Pipeline (Post-Optimization)

The `/query` endpoint now implements a **hybrid search** pattern with multiple ranking signals:

1. **Vector Search** (Cloudflare Vectorize)
   - Returns top-15 candidates based on embedding similarity
   - Uses contextual embeddings: `[Document][Chapter][Heading][HS Codes] + page text`

2. **Lexical Reranking** (in-memory, < 30ms)
   - **HS code extraction:** Regex `\b\d{4}\.\d{2}(?:\.\d{2})?\b` matches queries like "0102.29.11"
   - **Keyword extraction:** Tokenization + EN/VI stopword filtering (20-token Vietnamese list)
   - **Fuzzy matching:** Levenshtein distance ≤ 2 for typo tolerance
   - **Scoring components:**
     - Vector cosine: `0.6 × score` (primary signal)
     - HS code exact match: `+1.0` per match in metadata (dominant for HS-specific queries)
     - Keyword in heading: `+0.20` (context boost)
     - Keyword exact in text: `+0.10` per match, capped at 3
     - Keyword fuzzy (Levenshtein ≤ 2): `+0.05`
     - RRF (reciprocal rank fusion): `1/(60+rank) × 0.05` (tiebreaker)

3. **Result Filtering & Deduplication**
   - **Score threshold:** Drop results < 0.45 cosine (noise suppression; always keep top-1)
   - **Deduplication:** Collapse multiple pages with same `document + heading`; merge HS codes
   - **Top-5 candidates** returned to LLM for context

4. **Context Assembly & Answer Generation**
   - Build markdown-formatted context with citations
   - Include `scorePct` (relevance %) in citation metadata
   - LLM prompt: Llama 3.3 70B with language-mirroring instruction
   - Fallback messages in both English and Vietnamese

### Citation Interface

```typescript
interface Citation {
  document: string       // e.g. "Chapter01.pdf"
  chapterNum: number     // Chapter number
  pageNum: number        // Physical page in PDF
  heading: string        // Extracted commodity name/description
  hsCodes: string[]      // Associated HS codes (deduplicated)
  score: number          // Raw cosine similarity (0–1)
  scorePct: number       // Relevance percentage (0–100, rounded)
}
```

Example source label in generated context:
```
[1] Chapter01.pdf, Page 1 — OXEN (relevance 87%)
```

## Key Concepts

### PageIndexNode Interface

Each indexed document page is represented as:

```typescript
interface PageIndexNode {
  id: string           // e.g. "chapter01-p1"
  document: string     // e.g. "Chapter01.pdf"
  chapterNum: number   // Chapter number (0 for Introduction)
  pageNum: number      // Physical page number in PDF (1-indexed)
  hsCodes: string[]    // Extracted HS codes: ["0102.29.11", "0105.11.10"]
  heading: string      // Best descriptive label for page
  text: string         // Full page text for embedding
}
```

### HS Code Format

HS codes follow the structure:
```
XXXX.XX[.XX]
```

Examples:
- `0102.29` — 6-digit HS code (section level)
- `0102.29.11` — 8-digit HS code (tariff line level)

**Regex pattern:** `\b\d{4}\.\d{2}(?:\.\d{2})?\b`

### Continuation Page Handling

Pages without HS codes (e.g., continuation of detailed descriptions) inherit HS codes from the previous page:

```typescript
// From page-indexer.ts
const effectiveHsCodes = hsCodes.length > 0 ? hsCodes : [...lastHsCodes]
```

This ensures all nodes are searchable by their relevant HS codes even if the page itself has no codes printed.

## Environment Configuration

### Scripts / Ingestion (`scripts/.env`)

```bash
# Cloudflare credentials (for Vectorize upload during ingestion)
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_API_TOKEN=your_api_token_with_vectorize_edit
CF_VECTORIZE_INDEX=hscode-rag-index

# Google Gemini API (for embedding ingestion, legacy support)
GEMINI_API_KEY=your_gemini_api_key
```

### Worker Bindings (`worker/wrangler.toml`)

```toml
# Cloudflare Workers AI (automatic, no config needed)
[env.production]
[[env.production.ai]]
binding = "AI"   # For text embedding queries + generating answers

# Vectorize index binding
[[env.production.vectorize]]
binding = "VECTORIZE"
index_name = "hscode-rag-index"
```

**Note:** Query embedding and answer generation now use Cloudflare Workers AI (no external API keys for query-time LLM calls).

## Quick Start

### 1. Local Development Setup

```bash
# Install dependencies
npm install

# Set up credentials
cp .env.example scripts/.env
# Edit scripts/.env with actual credentials
```

### 2. Ingest Data (Scripts)

```bash
cd scripts

# Dry run: parse PDFs and show first 3 nodes
npm run ingest:dry

# Full ingestion: parse → embed → upload
npm run ingest
```

Expected output:
```
📂 Parsing PDFs from .../dataset ...
   Found 120 pages
📋 PageIndex built: 120 nodes
   [chapter01-p1] "LIVE ANIMALS" — HS: 0102.29, 0105.11
...
🔢 Embedding 120 nodes with gemini-embedding-001 (768 dims)...
   120/120 embedded
☁️  Uploading to Cloudflare Vectorize (index: hscode-rag-index) ...
✅ Ingestion complete — 120 vectors in Cloudflare Vectorize
```

### 3. Run Worker Locally

```bash
cd worker

# Start local dev server (listens on http://localhost:8787)
npx wrangler dev
```

Test with:
```bash
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"question":"What HS code covers beef?"}'
```

### 4. Run Frontend Locally

```bash
cd frontend

# Start dev server (listens on http://localhost:5173)
npm run dev
```

Open http://localhost:5173 in browser. The UI will communicate with the worker API.

## Deployment

### Deploy Worker to Cloudflare

```bash
cd worker

# Deploy to Cloudflare Workers
npx wrangler deploy

# Verify index exists
npx wrangler vectorize info hscode-rag-index
```

### Deploy Frontend to Cloudflare Pages

```bash
cd frontend

# Build production assets
npm run build

# Deploy with Wrangler
npx wrangler pages deploy dist
```

## File Naming Conventions

- **Chapters:** `Chapter{N}.pdf` (e.g., `Chapter01.pdf`, `Chapter21.pdf`)
- **Node IDs:** `{chapter-slug}-p{pageNum}` (e.g., `chapter01-p5`)
- **Config files:** kebab-case (e.g., `wrangler.toml`)
- **Source code:** camelCase for files, PascalCase for classes/interfaces

## Rate Limiting & Quotas

- **Gemini Embedding API:** ~100 requests/minute on free tier
  - Ingestion script uses 650ms delay between embeds to respect limit
  - Adjust `EMBED_DELAY_MS` in `ingest.ts` if needed

- **Cloudflare Vectorize:** Check dashboard for query quota and included vectors

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "GEMINI_API_KEY not set" | Copy `.env.example` → `scripts/.env` and add your API key |
| PDF parser fails | Ensure PDFs are in `dataset/` with names matching `Chapter{N}.pdf` |
| Vectorize upload fails | Verify `CF_ACCOUNT_ID`, `CF_API_TOKEN`, and `CF_VECTORIZE_INDEX` in `.env` |
| CORS errors in frontend | Check worker `wrangler.toml` has correct origin settings |
| Embedding timeout | Increase `EMBED_DELAY_MS` if hitting rate limits |

## Next Steps

- Add PDF upload UI in frontend
- Implement conversation history / session memory
- Add citation links to original PDF pages
- Performance tuning for large datasets (pagination, caching)
- Add admin dashboard for index management
