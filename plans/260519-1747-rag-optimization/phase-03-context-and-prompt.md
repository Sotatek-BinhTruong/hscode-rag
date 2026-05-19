# Phase 3 — Context Assembly + Generation Improvements

## Context Links
- `worker/src/services/context-assembler.ts`
- `worker/src/services/workers-ai-generate-service.ts`
- Reference dedup pattern: `pageindex-engine/lib/ai/retrieval/hybrid-search.ts` (`consolidateByNode` for inspiration; ours is simpler — by `document+heading`)

## Overview
- **Priority:** P2
- **Status:** completed
- **Effort:** 1.5h
- **Goal:** Polish the answer-generation surface — dedupe near-duplicate citations, filter low-confidence matches, mirror query language, return richer citation metadata.

## Key Insights
- After Phase 2 rerank, top-5 may contain multiple pages from same `document+heading` (e.g. multi-page commodity entries). Collapse to one.
- Vectorize cosine < 0.45 = mostly noise for bge-base; surfacing such results misleads users and Llama may hallucinate citations.
- Llama 3.3 70B is multilingual; one explicit instruction line is sufficient to mirror query language.

## Requirements

### Functional
- `dedupeResults(results)`: collapse entries with identical `document + heading`, keep highest score; merge HS codes; keep highest pageNum range if needed.
- `filterByScoreThreshold(results, threshold=0.45)`: drop matches below threshold; if filter leaves 0 results, keep top 1 anyway (avoid empty context).
- Citation now includes: `scorePct: number` (round(score × 100)).
- System prompt update:
  - Answer in same language as query.
  - Vietnamese-friendly phrasing for "not found" fallback.
  - Keep existing citation/HS-code formatting rules.

### Non-Functional
- Pure functions; unit-testable.
- Backwards-compatible JSON response (added field only).

## Architecture

```
top-5 SearchResults (from Phase 2)
   ↓
filterByScoreThreshold(0.45)   ┐
dedupeResults()                 │  pure transforms in context-assembler.ts
   ↓
assembleContext() → { contextText, citations[] }
   ↓
generateAnswer(query, contextText)
   ↑
   updated SYSTEM_PROMPT (language mirroring + VI fallback)
```

## Related Code Files

### Modify
- `worker/src/services/context-assembler.ts` — add dedupe + score filter; enrich citation shape; include score in source label.
- `worker/src/services/workers-ai-generate-service.ts` — update `SYSTEM_PROMPT`.

### Read-only
- `worker/src/routes/query-route.ts` — no signature change needed; consumes existing assembler API.

## Implementation Steps

1. **`context-assembler.ts`** — add helpers:
   ```ts
   const SCORE_THRESHOLD = 0.45

   function filterByScoreThreshold(results: SearchResult[]): SearchResult[] {
     const filtered = results.filter(r => r.score >= SCORE_THRESHOLD)
     return filtered.length > 0 ? filtered : results.slice(0, 1)
   }

   function dedupeResults(results: SearchResult[]): SearchResult[] {
     const seen = new Map<string, SearchResult>()
     for (const r of results) {
       const key = `${r.document}::${r.heading}`
       const existing = seen.get(key)
       if (!existing || r.score > existing.score) {
         // Merge HS codes from collapsed entry
         const mergedHs = existing
           ? [...new Set([...existing.hsCodes, ...r.hsCodes])]
           : r.hsCodes
         seen.set(key, { ...r, hsCodes: mergedHs })
       } else {
         existing.hsCodes = [...new Set([...existing.hsCodes, ...r.hsCodes])]
       }
     }
     return [...seen.values()]
   }
   ```
2. Update `assembleContext`:
   ```ts
   export function assembleContext(results: SearchResult[]): AssembledContext {
     const filtered = filterByScoreThreshold(results)
     const deduped = dedupeResults(filtered)
     // existing forEach logic, but citation now includes scorePct
     // source label: `[1] Chapter01.pdf, Page 1 — OXEN (relevance 87%)`
   }
   ```
3. Update `Citation` interface:
   ```ts
   export interface Citation {
     document: string
     chapterNum: number
     pageNum: number
     heading: string
     hsCodes: string[]
     score: number       // raw cosine
     scorePct: number    // rounded percentage
   }
   ```
4. **`workers-ai-generate-service.ts`** — replace `SYSTEM_PROMPT`:
   ```ts
   const SYSTEM_PROMPT = `You are an expert on the ASEAN Harmonized Tariff Nomenclature (HSCode).
   Answer questions based ONLY on the provided context documents.

   Language: respond in the SAME language as the user's question. If the question is in Vietnamese, answer in Vietnamese; if English, answer in English.

   Rules:
   - Cite each source using its label from context (e.g., [1] Chapter01.pdf, Page 1 — OXEN).
   - When mentioning an HS code, use the exact format from context (e.g., 0102.29.11).
   - Be concise and precise.
   - If the answer is not in the context, say:
     - English: "I could not find this information in the provided documents."
     - Vietnamese: "Tôi không tìm thấy thông tin này trong tài liệu được cung cấp."`
   ```
5. **Unit tests**:
   - `dedupeResults`: two entries same doc+heading → 1 entry with merged hsCodes.
   - `filterByScoreThreshold`: all below 0.45 → returns top-1 (not empty).
   - `assembleContext`: citation has `scorePct` field, source label contains percentage.
6. **E2E test**: curl with Vietnamese query, assert response contains Vietnamese characters (regex `/[À-ỹ]/`).

## Todo List

- [x] Add `dedupeResults` to `context-assembler.ts`
- [x] Add `filterByScoreThreshold` with empty-set safety
- [x] Add `scorePct` field to `Citation` interface
- [x] Update source label with relevance percentage
- [x] Update `SYSTEM_PROMPT` for language mirroring + Vietnamese fallback
- [x] Unit tests for dedupe + threshold filter
- [x] E2E Vietnamese query test
- [x] Verify frontend (if any) handles added `scorePct` field gracefully
- [x] Deploy worker

## Success Criteria

- Citations array never contains two entries with same `document + heading`.
- Citations with score < 0.45 are dropped (unless they're the only result).
- Each citation has `scorePct` integer 0-100.
- Source labels in context include relevance percentage.
- Vietnamese query produces Vietnamese answer (manual + regex check).
- Existing English queries unchanged in language; format unchanged except added percentage.

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|------------|
| Threshold 0.45 too strict — strips legitimate matches | M×M | Keep top-1 fallback when filter empties; tunable constant in one place |
| Dedupe merges different pages losing detail | L×L | Key is `document + heading` (same logical entry); page numbers in PageIndexNode are pre-grouped per page anyway |
| Llama responds in wrong language despite instruction | M×L | Explicit fallback strings in both languages baked into prompt; if regressions, add 1 few-shot exemplar |
| Frontend hard-codes Citation shape, breaks on new field | L×M | Field is additive; check `frontend/` for any strict type guard before deploy |
| Added percentage in source label confuses Llama, ends up in answer | L×L | Llama usually strips meta; if it leaks, move percentage to citations array only and keep label clean |

## Security Considerations
- No new external calls. Pure data shaping + prompt edit.
- Score values not sensitive — safe to expose to client.

## Next Steps
- After deploy, monitor a sample of queries; tune `SCORE_THRESHOLD` based on observed cosine distributions.
- Update `docs/codebase-summary.md` with new citation field.
- Consider exposing reranker score components in a `/query?debug=1` mode (cross-cuts Phase 2 + 3).
