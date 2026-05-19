/**
 * POST /query — main RAG endpoint.
 * Embeds the user question, searches Vectorize, assembles context, generates answer.
 */
import { Hono } from 'hono'
import type { Bindings } from '../index.ts'
import { embedQuery } from '../services/workers-ai-embed-service.ts'
import { searchVectorize } from '../services/vectorize-search-service.ts'
import { extractHsCodes } from '../services/hs-code-detector.ts'
import { extractKeywords } from '../services/keyword-search-service.ts'
import { rerankCandidates } from '../services/reranker-service.ts'
import { assembleContext } from '../services/context-assembler.ts'
import { generateAnswer } from '../services/workers-ai-generate-service.ts'

export const queryRoute = new Hono<{ Bindings: Bindings }>()

queryRoute.post('/', async (c) => {
  let body: { query?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const query = body.query?.trim()
  if (!query) {
    return c.json({ error: 'query field is required and must be non-empty' }, 400)
  }
  if (query.length > 2000) {
    return c.json({ error: 'query too long (max 2000 characters)' }, 400)
  }

  const embedding = await embedQuery(query, c.env.AI)
  const candidates = await searchVectorize(c.env.VECTORIZE, embedding)
  const reranked = rerankCandidates({
    queryHsCodes: extractHsCodes(query),
    keywords: extractKeywords(query),
    candidates,
  })
  // Normalize score → finalScore so assembleContext threshold/dedup uses reranker ranking
  const top5 = reranked.slice(0, 5).map(r => ({ ...r, score: r.finalScore }))
  const { contextText, citations } = assembleContext(top5)
  const answer = await generateAnswer(query, contextText, c.env.AI)

  return c.json({ answer, citations })
})
