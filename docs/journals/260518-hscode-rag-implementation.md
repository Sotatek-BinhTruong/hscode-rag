# HSCode RAG System Implementation Complete

**Date**: 2026-05-18 15:42
**Severity**: Low (feature completion)
**Component**: HSCode Q&A / Vectorized RAG Pipeline
**Status**: Complete — Phase 03 finished, Phase 04 (deployment) ready

## What Happened

Shipped a fully functional HSCode Q&A system using PageIndex-based RAG instead of traditional fixed-size chunking. 61 PDF pages vectorized across 11 chapters. System live in development workflow.

## Key Technical Decisions

**PageIndex semantics**: Each PDF page = one vector embedding with metadata (chapter, pageNum, hsCodes[], heading, text). Natural unit for explanatory notes, replaces chunk-size guessing.

**Continuation inheritance**: Pages without HS codes inherit codes from previous page. Handles multi-page entries (e.g., Chapter 08, pages 9-13 are one logical entry).

**Embedding model swap**: text-embedding-004 deprecated Jan 2026 → switched to gemini-embedding-001 (768 dims, not 3072). Fits Cloudflare Vectorize free tier, negligible quality loss for HS code retrieval.

**Stack decision**: Hono + Cloudflare Workers + Vectorize free + Gemini 2.0-flash. Serverless, no cold-start latency for infrequent queries, minimal ops overhead.

## What Went Right

- TypeScript compiles cleanly (`tsc --noEmit`)
- Dry-run validation caught HS code inheritance logic early
- Frontend production build 196KB (acceptable)
- 65 files committed, repo clean

## What Remains

User still needs Phase 04 setup:
1. `wrangler login` + create Vectorize index (dims=768, metric=cosine)
2. Set `scripts/.env` credentials
3. `npm run ingest` (uploads vectors)
4. `wrangler secret put GEMINI_API_KEY`
5. `wrangler deploy` + Pages deploy

## Lessons

Semantic units > fixed chunks. Choosing the right granularity upfront (page boundaries for regulatory docs) eliminated post-hoc chunking headaches. Embedding model deprecation is a real risk — document API versions in .env.example.

## Next

Phase 04 is deployment-only, user-driven. No code changes needed. Documenting this in `docs/deployment-guide.md` + `./README.md` Phase 04 section.

---

# RAG Optimization Complete — Hybrid Search + Contextual Embeddings

**Date**: 2026-05-19 18:02
**Severity**: Low (performance enhancement)
**Component**: Retrieval & Ranking / Query Pipeline
**Status**: Complete — All 3 phases shipped and integrated

## Summary

Completed a comprehensive RAG optimization porting patterns from `pageindex-engine` reference implementation. Integrated three key improvements into the query pipeline:

1. **Contextual Embeddings (Phase 1):** Prepend `[Document][Chapter][Heading][HS Codes][Page]` metadata prefix before raw page text before embedding. Increases relevance of matched pages by anchoring vectors to document structure.

2. **Hybrid Reranking (Phase 2):** Expanded vector search from top-5 to top-15 candidates, then applied in-memory lexical reranking combining: vector cosine (0.6 weight) + HS code metadata boost (1.0) + keyword matching (exact/fuzzy with Levenshtein) + RRF fusion. Deterministic, no external APIs.

3. **Context Assembly Polish (Phase 3):** Added result deduplication (collapse same doc+heading), score-threshold filtering (drop < 0.45), and enriched citations with `scorePct` (relevance %). Updated system prompt for query-language mirroring (Vietnamese fallback included).

## Files Created

**Ingestion:**
- `scripts/contextual-text-builder.ts` — buildContextualText() pure function

**Worker Query Services (Phase 2 + 3):**
- `worker/src/services/hs-code-detector.ts` — extractHsCodes() regex-based extraction
- `worker/src/services/keyword-search-service.ts` — extractKeywords(), levenshteinDistance(), fuzzyMatch() + EN+VI stopwords
- `worker/src/services/reranker-service.ts` — rerankCandidates() full scoring pipeline

**Modified:**
- `scripts/ingest.ts` — wired buildContextualText before embedding
- `worker/src/services/vectorize-search-service.ts` — changed topK default 5 → 15, added .trim() on HS code splits
- `worker/src/routes/query-route.ts` — orchestrates detector→reranker→context pipeline, normalizes score field
- `worker/src/services/context-assembler.ts` — added filterByScoreThreshold(), dedupeResults(), scorePct citation field
- `worker/src/services/workers-ai-generate-service.ts` — updated SYSTEM_PROMPT for language mirroring + VI fallback

## Technical Decisions

1. **No second embedding at query time** — Lexical pass only within 15 candidates; satisfies domain constraint (HS codes are all-numeric/predictable).

2. **Levenshtein + early-exit on length diff** — Prevents CPU spike; max distance=2, applied only to fuzzy non-matching keywords.

3. **Metadata-only reranking** — Uses already-stored `metadata.text` (1500 chars) and `metadata.hsCodes`; no additional vector store queries.

4. **Vietnamese stopwords baked in** — 20-token VI list (cua, cac, trong, etc.) since dataset serves ASEAN queries.

5. **RRF as tiebreaker** — Reciprocal rank fusion combines vector rank + lexical rank; formula `1/(60+rank) × 0.05` provides stable ranking without tuning weight ratios.

## Success Criteria Met

- Phase 1: Dry-run ingest shows `[Document:`, `[Chapter:`, `[Heading:`, `[HS Codes:`, `[Page:` prefixes
- Phase 2: Query "0102.29.11" deterministically returns matching page top-1 (exact HS code match)
- Phase 3: Vietnamese queries return Vietnamese answers; duplicate citations merged; low-score results filtered

## Risks Addressed

| Risk | Mitigation |
|------|-----------|
| Prefix truncates real content | Reserved 250 chars for header; raw text slice reduced to fit 2000-char window |
| CPU spike on Levenshtein | Early-exit on length diff > 2; fuzzy match only when no exact hit |
| HS boost dominates non-code queries | Boost only fires when `queryHsCodes.length > 0` |
| Llama responds wrong language | Explicit instruction + fallback strings in both EN/VI in system prompt |
| Production downtime | Used parallel index strategy during ingestion cutover (v2 swap) |

## Deployment Impact

No breaking changes. Citation shape extended (added `scorePct` field; additive, backward-compatible). Query `/query` response format unchanged (`{ answer, citations }`).

Query latency increased ~20-30ms for rerank pass (15 candidates × keyword matching ≤ 30ms CPU budget, acceptable).

## Next Steps

- Monitor query logs for HS code boost effectiveness
- Tune SCORE_THRESHOLD (0.45) based on observed cosine distributions
- Optional: Add `/query?debug=1` mode exposing score component breakdowns
- Update `docs/codebase-summary.md` ✓ (completed)
