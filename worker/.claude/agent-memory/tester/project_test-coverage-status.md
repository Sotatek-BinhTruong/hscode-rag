---
name: hscode-rag-worker-test-coverage-status
description: hscode-rag Worker has zero test coverage; critical services lack unit tests
metadata:
  type: project
---

## Test Coverage Status: hscode-rag Worker

**Finding:** Worker project has ZERO test coverage. 9 TS modules, 0 test files.

**Why:** Untested code in production increases risk of bugs in critical RAG pipeline (embedding → search → rerank → assemble → generate). No regression protection on complex scoring algorithms.

**How to apply:** When implementing features or fixes in this project, MUST also create unit tests for affected services. Test framework not yet set up — will need Vitest or Jest with TS support.

**Key Services Needing Tests (Priority):**
1. `keyword-search-service.ts` — Keyword extraction, Levenshtein distance, fuzzy matching (100 LOC, complex)
2. `reranker-service.ts` — Multi-signal scoring with RRF blend (106 LOC, critical business logic)
3. `context-assembler.ts` — Deduplication + filtering (79 LOC, data integrity)
4. `hs-code-detector.ts` — Regex extraction (11 LOC, simple but untested)
5. `query-route.ts` — Request/response contract (41 LOC, needs integration test)

**TypeScript Status:** Compiles cleanly (`tsc --noEmit` passes).

**Test Infrastructure Needed:**
- Test framework (Vitest or Jest)
- `src/__tests__/` directory
- Test script in `package.json`
- Coverage reporting setup

**Blockers:** None — can start immediately.
