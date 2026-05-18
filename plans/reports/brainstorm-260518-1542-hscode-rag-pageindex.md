# Brainstorm Report: HSCode RAG với PageIndex

**Date:** 2026-05-18 | **Status:** Approved

## Problem Statement

Xây dựng hệ thống hỏi đáp HSCode dựa trên PageIndex thay vì chunking RAG truyền thống. Hệ thống parse PDF explanatory notes của ASEAN Harmonized Tariff Nomenclature, build PageIndex với metadata chính xác (chapter/page/section/HS code), cho phép semantic search và trả lời kèm citation.

**Dataset:** 11 chapter PDFs + Introduction.pdf tại `./dataset/`
**PDF type:** Text-based, searchable (pdftotext works)
**Structure:** Mỗi trang = 1 HS code entry (code + heading + description + picture caption)

## PageIndex vs Traditional RAG

| | Traditional RAG | PageIndex approach |
|--|--|--|
| Chunking | Fixed-size (512 token) | Page = natural semantic unit |
| Citation | Mất context | Chapter X, Page Y, HS: XXXX.XX.XX |
| Split risk | Description bị cắt giữa chừng | Không — 1 entry = 1 page |
| Metadata | Ít | chapter, pageNum, hsCodes[], heading |

## Final Stack Decision

| Layer | Tech | Lý do |
|-------|------|-------|
| PDF Parsing | `pdftotext` (local CLI) | Available on Ubuntu, text-based PDF |
| Ingestion | TypeScript CLI script | Chạy 1 lần local, push lên Vectorize |
| Backend | Hono + Cloudflare Workers | Lightweight, TypeScript-first, Vectorize binding native |
| Vector DB | Cloudflare Vectorize (free) | ~100 vectors << 10M limit, zero infra |
| Embedding | Gemini `text-embedding-004` | Provider consistency với LLM |
| LLM | Gemini `gemini-2.0-flash` | Fast, cheap, good for document Q&A |
| Frontend | React + Vite → Cloudflare Pages | SPA = đủ, không cần SSR |

## PageIndex Node Structure

```typescript
interface PageIndexNode {
  id: string;          // "chapter01-p1"
  document: string;    // "Chapter01.pdf"
  chapterNum: number;  // 1
  pageNum: number;     // 1
  hsCodes: string[];   // ["0102.29.11"]
  heading: string;     // "OXEN"
  text: string;        // full page text
}
// Vector stored in Cloudflare Vectorize with above as metadata payload
```

## Query Pipeline

```
User query
  → Gemini text-embedding-004
  → Vectorize ANN search (top 5)
  → Context assembly với citations
  → Gemini gemini-2.0-flash generate
  → Response + citation cards [Chapter X, Page Y, HS: XXXX]
```

## Project Structure

```
hscode-rag/
├── worker/           # Hono + Cloudflare Workers
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/query.ts
│   │   └── services/
│   │       ├── embedding.ts   # Gemini embedding
│   │       ├── vectorize.ts   # Vectorize search
│   │       └── gemini.ts      # LLM generation
│   └── wrangler.toml
├── frontend/         # React + Vite → Cloudflare Pages
│   └── src/
│       ├── components/ChatWindow.tsx
│       ├── components/CitationCard.tsx
│       └── hooks/useChat.ts
├── scripts/          # Local ingestion CLI (Node.js)
│   └── ingest.ts     # PDF → PageIndex → Vectorize
└── dataset/          # PDF files
```

## Implementation Phases

1. **Ingestion Pipeline** — PDF parse → PageIndex → embed → Vectorize
2. **Query API** — Hono Worker: embed query → Vectorize search → Gemini generate
3. **Web Frontend** — React + Vite chat UI với citation display
4. **Deploy** — `wrangler deploy` + Cloudflare Pages

## Risks

- Gemini embedding API rate limits khi ingest nhiều pages → add delay/batch
- `pdftotext` heading detection dựa trên ALL CAPS pattern → test trên all chapters
- Cloudflare Workers free: 100k requests/day — đủ cho demo/production nhỏ

## Unresolved Questions

- Có cần admin UI để re-ingest PDF không, hay CLI đủ?
- Multilingual support (tiếng Việt) hay chỉ English PDF?
- Streaming response (SSE) hay wait-for-full-response?
