---
title: "RAG optimization for hscode-rag (contextual embed + hybrid rerank)"
description: "Port pageindex-engine retrieval patterns into hscode-rag: contextual embeddings, hybrid keyword+vector rerank, HS code boost, Vietnamese support."
status: completed
priority: P2
effort: 6h
branch: master
tags: [rag, retrieval, hybrid-search, cloudflare-workers, vectorize]
created: 2026-05-19
completed: 2026-05-19
---

# RAG Optimization Plan

Adopt three proven patterns from `pageindex-engine` while respecting Cloudflare Workers constraints (no Postgres/Qdrant, no extra embed call per query).

## Phases

| # | Phase | File | Status | Effort | Deployable |
|---|-------|------|--------|--------|------------|
| 1 | Contextual Embedding (Ingestion) | [phase-01-contextual-embedding.md](./phase-01-contextual-embedding.md) | completed | 1.5h | Independent (re-ingest) |
| 2 | Hybrid Search + Reranker (Worker) | [phase-02-hybrid-rerank.md](./phase-02-hybrid-rerank.md) | completed | 3h | Independent (worker deploy) |
| 3 | Context Assembly + Generation Polish | [phase-03-context-and-prompt.md](./phase-03-context-and-prompt.md) | completed | 1.5h | Independent (worker deploy) |

## Dependency Graph

```
Phase 1 (contextual embed)   ── re-ingest ─┐
                                            ├─→ Phase 2 (hybrid rerank reads enriched text from metadata)
Phase 2 (hybrid rerank) ───────────────────┘
                                            └─→ Phase 3 (assembler consumes reranked SearchResult shape)
```

- Phase 2 and Phase 3 can ship without Phase 1, but Phase 1 boosts every downstream gain. Recommended order: 1 → 2 → 3.
- Phase 3 depends on Phase 2's `SearchResult` shape only if score fields are added; otherwise independent.

## File Ownership (no cross-phase conflicts)

| Phase | Owned files |
|-------|-------------|
| 1 | `scripts/ingest.ts`, `scripts/page-indexer.ts` (read), `scripts/vectorize-uploader.ts` |
| 2 | `worker/src/services/keyword-search-service.ts` (new), `worker/src/services/hs-code-detector.ts` (new), `worker/src/services/reranker-service.ts` (new), `worker/src/services/vectorize-search-service.ts`, `worker/src/routes/query-route.ts` |
| 3 | `worker/src/services/context-assembler.ts`, `worker/src/services/workers-ai-generate-service.ts` |

`query-route.ts` is touched by both Phase 2 (wire reranker) and Phase 3 (only if signature changes). Phase 3 must rebase on Phase 2 if both ship.

## Key Architectural Decisions

1. **No second embedding call at query time.** Skip pageindex-engine's semantic reranker (uses Gemini embedding API per query). Use lexical-only rerank pass — sufficient for HS code domain where exact codes and ALL-CAPS commodity names dominate queries.
2. **No Postgres BM25.** Re-implement BM25-inspired scoring in worker using metadata.text (1500 chars, already in Vectorize). Acceptable since topK candidates ≤ 15.
3. **HS code regex boost as first-class signal.** HS codes are the domain's primary key; exact match in query MUST dominate ranking.
4. **Flat structure preserved.** Chapters are 1-2 pages; no tree consolidation needed (skip `consolidateByNode`).
5. **Vietnamese stopwords included from day 1.** Dataset is ASEAN tariff; Vietnamese queries are expected.

## Backwards Compatibility / Migration

- **Phase 1 requires re-ingest.** Existing 768-dim vectors in `hscode-rag-index` become stale (different embedded text → different vectors). Procedure: delete index → `wrangler vectorize create hscode-rag-index --dimensions=768 --metric=cosine` → `npm run ingest`.
- **Vectorize metadata schema unchanged.** Same keys (`document`, `chapterNum`, `pageNum`, `hsCodes`, `heading`, `text`). Only the embedded text changes.
- **`/query` response shape unchanged** by Phase 2/3 (still `{ answer, citations }`). New citation field `scorePct` is additive.

## Rollback Plan

| Phase | Rollback |
|-------|----------|
| 1 | `git revert` ingest changes → re-run ingestion against fresh index (or restore prior index from a wrangler snapshot if kept). Old worker code keeps working with old vectors. |
| 2 | `git revert` worker commits → redeploy. Vectorize index untouched. No data migration. |
| 3 | `git revert` context-assembler + generate-service → redeploy. Pure presentation/prompt change. |

## Test Matrix

| Layer | Phase 1 | Phase 2 | Phase 3 |
|-------|---------|---------|---------|
| Unit | `buildContextualText()` snapshot test | `extractKeywords` (EN+VI), `levenshtein`, `extractHsCodes`, `rerank()` scoring | `dedupeResults()`, `formatCitation()` |
| Integration | dry-run ingest prints expected contextual text | `query-route` with mock Vectorize returns reranked order | full `/query` golden cases |
| E2E | Re-run ingest on `dataset/` → assert vector count = page count | curl `/query` with HS code `0102.29.11` returns matching page top-1 | curl with Vietnamese query "Thịt bò sống mã HS nào?" returns Vietnamese answer |

## Success Criteria (measurable)

- **Phase 1:** Re-ingest succeeds end-to-end; sample query "live cattle" returns page containing 0102 family in top-3 (was top-5 or absent).
- **Phase 2:** Query "0102.29.11" returns that exact HS code page as top-1 (deterministic via metadata HS code boost). Query "live cattle" improves top-1 precision vs Phase 1 baseline on 5 hand-curated cases.
- **Phase 3:** Vietnamese query produces Vietnamese answer. Duplicate citations (same chapter+heading) collapsed. No citation with cosine score < 0.45 surfaces.

## Risk Register (High items)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Re-ingest deletes prod index, worker queries fail during gap | M | H | Create a new index `hscode-rag-index-v2`, ingest there, swap `wrangler.toml` binding atomically, then delete old |
| Contextual prefix exceeds bge-base 512-token window, truncates real content | M | M | Keep prefix < 80 tokens; truncate raw text to first ~1800 chars (was 2000) — prefix + text ≤ 2000 chars total |
| Levenshtein per-token across 15 candidates × all keywords blows worker CPU budget | L | M | Early-exit Levenshtein on length-delta > 2 (already in reference impl); cap candidates at 15; cap text scan at metadata.text (1500 chars) |
| HS code boost over-fires on partial digit sequences in text | L | M | Use strict regex with word boundaries `\b\d{4}\.\d{2}(?:\.\d{2})?\b` (already proven in `page-indexer.ts`) |
| Llama 3.3 responds in English even when prompted to mirror query language | M | L | Add explicit instruction + 1 Vietnamese few-shot exemplar in system prompt; verify via E2E |

## Unresolved Questions

1. Is there a smoke-test corpus of expected query→top-1-page pairs to lock the success bar quantitatively? If not, Phase 2 success criteria stays qualitative.
2. Should we keep the old Vectorize index as a fallback for A/B during Phase 1 rollout, or fully replace?
3. Are Vietnamese queries actually expected, or is the ASEAN dataset queried only in English? Affects Phase 3 prompt weight.
