# Phase 1 — Contextual Embedding (Ingestion)

## Context Links
- Reference: `/home/sotatek/Workspace/pageindex-engine/lib/ai/retrieval/section-builder.ts` (`buildContextualText`, lines 230-250)
- Current ingest: `scripts/ingest.ts` (line 91 `node.text.slice(0, 2000)`)
- Indexer: `scripts/page-indexer.ts`
- Uploader: `scripts/vectorize-uploader.ts`

## Overview
- **Priority:** P2
- **Status:** completed
- **Effort:** 1.5h
- **Goal:** Replace raw-page-text embedding with rich contextual text that bundles document, chapter, heading, HS codes ahead of the page body. Proven in reference project to materially lift retrieval recall.

## Key Insights
- bge-base-en-v1.5 input limit ≈ 512 tokens (~2000 chars). Prefix MUST stay short (~80 tokens / ~300 chars) so raw text isn't excessively truncated.
- Vectorize metadata schema does NOT change. Only the vector `values` changes (because embedded text changes).
- This invalidates every existing vector → full re-ingest required.

## Requirements

### Functional
- Build contextual text per node:
  ```
  [Document: Chapter01.pdf]
  [Chapter: 1]
  [Heading: OXEN]
  [HS Codes: 0102.29.11, 0102.29.12]
  [Page: 1]

  <raw page text, truncated to fit 2000-char window>
  ```
- Embed contextual text instead of raw text.
- Continue storing the raw `node.text` (truncated to 1500) in Vectorize metadata for downstream rerank/display.

### Non-Functional
- Total contextual_text length ≤ 2000 chars (bge-base safe window).
- No new dependencies.
- Idempotent: re-running ingest on a fresh index produces identical vectors.

## Architecture

```
parseDatasetDir() → rawPages
   ↓
buildPageIndex() → PageIndexNode[]  (UNCHANGED)
   ↓
buildContextualText(node) → string  (NEW, inside ingest.ts or new util)
   ↓
embedText(contextualText) → number[768]
   ↓
uploadToVectorize(nodes, embeddings)  (metadata still uses node.text)
```

Data flow:
- **In:** PageIndexNode with `document, chapterNum, pageNum, hsCodes, heading, text`
- **Transform:** build prefix block (~5 lines), append raw text (truncated), embed
- **Out:** vector with embedding derived from contextual text; metadata stores original raw text

## Related Code Files

### Modify
- `scripts/ingest.ts` — call `buildContextualText` before `embedText`; reduce raw text slice to leave room for prefix.

### Create
- (Optional) `scripts/contextual-text-builder.ts` — pure function `buildContextualText(node: PageIndexNode): string`. KISS: inline in `ingest.ts` if < 20 lines. Recommended: extract for unit testing.

### Read-only
- `scripts/page-indexer.ts` — no changes
- `scripts/vectorize-uploader.ts` — no changes (metadata unchanged)

## Implementation Steps

1. Create `scripts/contextual-text-builder.ts`:
   ```ts
   import type { PageIndexNode } from './page-indexer.ts'

   const MAX_TOTAL_CHARS = 2000
   const PREFIX_RESERVED = 250  // upper bound for header block

   export function buildContextualText(node: PageIndexNode): string {
     const prefix = [
       `[Document: ${node.document}]`,
       `[Chapter: ${node.chapterNum}]`,
       `[Heading: ${node.heading}]`,
       `[HS Codes: ${node.hsCodes.join(', ') || 'none'}]`,
       `[Page: ${node.pageNum}]`,
       '',
     ].join('\n')

     const remaining = MAX_TOTAL_CHARS - prefix.length
     const body = node.text.slice(0, Math.max(0, remaining))
     return prefix + body
   }
   ```
2. In `scripts/ingest.ts`:
   - Import `buildContextualText`.
   - Replace `const textToEmbed = node.text.slice(0, 2000)` with `const textToEmbed = buildContextualText(node)`.
   - Log a sample contextual text for the first 3 nodes (debugging).
3. Add unit test (optional): `scripts/__tests__/contextual-text-builder.test.ts` — assert prefix lines present, total length ≤ 2000.
4. Run `npm run ingest:dry` to preview.
5. Create new index `hscode-rag-index-v2` (avoid prod downtime):
   ```
   cd worker && npx wrangler vectorize create hscode-rag-index-v2 --dimensions=768 --metric=cosine
   ```
6. Set `CF_VECTORIZE_INDEX=hscode-rag-index-v2` and run `npm run ingest`.
7. Swap `wrangler.toml` binding from `hscode-rag-index` to `hscode-rag-index-v2` and `wrangler deploy`.
8. After 24h healthy, delete old index.

## Todo List

- [x] Create `scripts/contextual-text-builder.ts`
- [x] Wire into `scripts/ingest.ts`
- [x] Dry-run preview (verify prefix in console output)
- [x] Create `hscode-rag-index-v2` Vectorize index
- [x] Run full ingest into v2
- [x] Update `worker/wrangler.toml` binding
- [x] Deploy worker
- [x] Smoke-test 3 queries
- [x] Delete old `hscode-rag-index` after grace period

## Success Criteria

- `ingest:dry` log shows first 3 nodes with `[Document:`, `[Chapter:`, `[Heading:`, `[HS Codes:`, `[Page:` prefix lines.
- Full ingest completes with vector count = page count.
- Manual sanity query "live cattle" returns at least one page with HS 0102.* in top 3 (was top 5 or absent).
- Query latency unchanged (embedding text size approximately same).

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| Prefix pushes raw text out of token window, losing semantic content | M×M | Cap prefix ~250 chars; reduce text slice to compensate |
| Production downtime during re-ingest | M×H | Use parallel index v2 + atomic binding swap (Step 5-7) |
| HS codes list very long for some pages, blows prefix budget | L×M | If `node.hsCodes.length > 8`, take first 8 + ellipsis |
| Heading is `UNKNOWN`, prefix becomes low-signal | M×L | Acceptable; vector still benefits from doc/chapter/page anchors |

## Security Considerations
- No new external calls. No new credentials. No PII in dataset.

## Next Steps
- Triggers Phase 2 (reranker assumes contextual embedding produces better candidate set).
- Update `docs/system-architecture.md` ingestion diagram.
