# Phase 2 — Hybrid Search + Reranker (Worker)

## Context Links
- Reference (BM25 + Levenshtein): `/home/sotatek/Workspace/pageindex-engine/lib/ai/retrieval/search.ts`
- Reference (rerank + RRF + HS-code-like structured terms): `/home/sotatek/Workspace/pageindex-engine/lib/ai/retrieval/hybrid-search.ts` (functions: `rrfScore`, `extractAnchorTerms`, `extractStructuredQueryTerms`, `rerankCandidates`)
- Existing services: `worker/src/services/vectorize-search-service.ts`, `worker/src/routes/query-route.ts`

## Overview
- **Priority:** P2
- **Status:** completed
- **Effort:** 3h
- **Goal:** Replace pure top-5 vector search with: expand-to-15 candidates → lexical rerank (keyword score + Levenshtein + HS code metadata boost) → slice to top 5.

## Key Insights
- HS codes are domain primary key. Query containing `0102.29.11` MUST surface the page whose metadata `hsCodes` contains that exact code, regardless of vector cosine score.
- Vectorize metadata already stores `text` (1500 chars) and `heading` and `hsCodes` — reranker reads these without extra round trips.
- No second embedding call. Lexical pass only.
- Vietnamese stopwords needed because the dataset serves ASEAN users.

## Requirements

### Functional
- Detect HS codes in query: `extractHsCodes(query): string[]`.
- Extract meaningful keywords (English + Vietnamese stopword filter): `extractKeywords(query): string[]`.
- Vector search returns 15 candidates (was 5).
- Rerank scoring per candidate:
  - **HS code exact match in `metadata.hsCodes`:** +1.0 per match (dominant signal)
  - **Keyword exact in `metadata.text`:** +0.10 per match, capped at 3 occurrences
  - **Keyword exact in `metadata.heading`:** +0.20 (header boost)
  - **Keyword fuzzy (Levenshtein ≤ 2) in text:** +0.05
  - **Vector cosine score:** +0.6 × cosine
  - **RRF fusion** between vector rank and lexical rank as tiebreaker: `1/(60+rank)`
- Return top-5 reranked, preserving original `SearchResult` fields plus computed scores.

### Non-Functional
- Worker CPU budget: rerank pass < 30ms for 15 candidates.
- No new bindings or dependencies.
- All scoring deterministic and unit-testable.

## Architecture

```
POST /query
   ↓
embedQuery(query) → number[768]
   ↓
searchVectorize(embedding, topK=15) → SearchResult[15]
   ↓
detectHsCodes(query) → string[]            ┐
extractKeywords(query) → string[]          │  parallel, pure
                                            ↓
rerankCandidates({ query, hsCodes, keywords, candidates }) → ScoredResult[]
   ↓
slice(top 5) → SearchResult[5]
   ↓
assembleContext → generateAnswer (unchanged here, see Phase 3)
```

## Related Code Files

### Create
- `worker/src/services/keyword-search-service.ts` — `extractKeywords`, `levenshteinDistance`, `fuzzyMatch`, `STOPWORDS` (EN+VI).
- `worker/src/services/hs-code-detector.ts` — `extractHsCodes(query): string[]` using existing regex.
- `worker/src/services/reranker-service.ts` — `rerankCandidates(params): ScoredResult[]`; pure function.

### Modify
- `worker/src/services/vectorize-search-service.ts` — change default `topK` to 15 (or accept caller override; keep default 15).
- `worker/src/routes/query-route.ts` — call detectors, then reranker; slice to 5; pass top-5 to assembler.

### Read-only
- `worker/src/services/context-assembler.ts` (untouched in Phase 2)

## Implementation Steps

1. **`hs-code-detector.ts`** (~15 lines):
   ```ts
   const HS_CODE_RE = /\b\d{4}\.\d{2}(?:\.\d{2})?\b/g
   export function extractHsCodes(query: string): string[] {
     return [...new Set([...query.matchAll(HS_CODE_RE)].map(m => m[0]))]
   }
   ```

2. **`keyword-search-service.ts`** (~120 lines):
   - Port `STOPWORDS` from reference `search.ts` (English).
   - Add Vietnamese tokens: `cua, cac, nhung, tren, trong, theo, cho, ve, hay, la, mot, nhieu, hang, va, hoac, khong, co, duoc, nay, do, gi, ma`.
   - `extractKeywords(query)` — lowercase, strip punctuation, split, filter `len > 2 && !STOPWORDS.has`.
   - `levenshteinDistance(a, b, maxDistance=2)` — port from reference; early-exit on length diff.
   - `fuzzyMatch(text, keyword)` — split text on whitespace, return true if any token within edit distance ≤ 2.
   - `countOccurrences(text, keyword)` — simple `indexOf` loop, capped at 3.

3. **`reranker-service.ts`** (~80 lines):
   ```ts
   export interface ScoredResult extends SearchResult {
     vectorScore: number
     lexicalScore: number
     hsCodeBoost: number
     finalScore: number
   }

   export function rerankCandidates(params: {
     query: string
     queryHsCodes: string[]
     keywords: string[]
     candidates: SearchResult[]
   }): ScoredResult[] {
     // 1. For each candidate compute lexicalScore from text + heading
     // 2. Compute hsCodeBoost = 1.0 × count(intersect(queryHsCodes, candidate.hsCodes))
     // 3. finalScore = 0.6*vectorScore + lexicalScore + hsCodeBoost + rrfBlend
     // 4. Sort desc; return
   }
   ```
   - RRF blend: compute candidate's rank by vectorScore-only and by lexicalScore-only, add `1/(60+rankV) + 1/(60+rankL)` × 0.05.

4. **Modify `vectorize-search-service.ts`:** change default `topK = 5` → `topK = 15`. No interface change.

5. **Modify `query-route.ts`:**
   ```ts
   const queryHsCodes = extractHsCodes(query)
   const keywords = extractKeywords(query)
   const candidates = await searchVectorize(c.env.VECTORIZE, embedding, 15)
   const reranked = rerankCandidates({ query, queryHsCodes, keywords, candidates })
   const top5 = reranked.slice(0, 5)
   const { contextText, citations } = assembleContext(top5)
   ```

6. **Unit tests** (`worker/src/services/__tests__/`):
   - `extractKeywords('What is the HS code for live cattle?')` → `['code', 'live', 'cattle']`
   - `extractHsCodes('Tell me about 0102.29.11')` → `['0102.29.11']`
   - `levenshteinDistance('cattle', 'cattl')` → 1
   - `rerankCandidates` golden test: 2 candidates, one with matching HS code metadata → HS code candidate ranks first.

7. **Integration test:** mock Vectorize binding, assert top-1 changes after rerank for HS code query.

## Todo List

- [x] Create `worker/src/services/hs-code-detector.ts`
- [x] Create `worker/src/services/keyword-search-service.ts` with EN+VI stopwords
- [x] Port Levenshtein with early-exit
- [x] Create `worker/src/services/reranker-service.ts`
- [x] Bump `vectorize-search-service.ts` default topK to 15
- [x] Wire reranker into `query-route.ts`
- [x] Unit tests for keyword extractor, HS detector, Levenshtein, rerank scoring
- [x] Integration test with mocked Vectorize
- [x] Deploy to staging, run 5 golden queries
- [x] Deploy prod

## Success Criteria

- Unit tests pass.
- Query `"0102.29.11 description"` returns the page whose metadata `hsCodes` contains `0102.29.11` as top-1 (deterministic).
- Query `"live cattle"` returns 0102.* page top-1 (was unpredictable).
- Query `"Thịt bò sống"` (live beef) — Vietnamese stopwords don't drown signal; relevant cattle/bovine pages surface.
- Worker P50 latency increases ≤ 50ms (rerank is in-memory over 15 small records).

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| Levenshtein over 1500-char metadata × 15 candidates × N keywords exceeds 50ms CPU | L×M | Early-exit on length diff (already in algo); cap keywords used in fuzzy to 5; only fuzzy when no exact match |
| HS code boost too strong, drowns vector signal for non-HS queries | M×M | Boost only fires when `queryHsCodes.length > 0`; for code-free queries, lexical+vector dominates |
| Rerank weights are heuristic; may regress some queries | M×M | Add `?debug=1` query param to return all score components; log to console for inspection |
| Vietnamese stopword list incomplete | M×L | Start with 20-token list from reference + curate; expand based on real query logs |
| Increased topK=15 hits Vectorize rate limit | L×L | Workers AI/Vectorize quotas comfortably absorb; topK is metadata-cheap |

## Security Considerations
- Inputs already user-controlled; reranker is read-only over Vectorize results. No injection surface.
- Regex `HS_CODE_RE` has bounded backtracking (`\b\d{4}\.\d{2}(?:\.\d{2})?\b`) — ReDoS-safe.

## Next Steps
- Phase 3 consumes the reranked `ScoredResult[]` (or downcast `SearchResult[]`) — may surface `finalScore` in citations.
- Add a `/query/debug` route exposing score components for tuning (optional).
