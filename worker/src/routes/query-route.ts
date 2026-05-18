/**
 * POST /query — main RAG endpoint.
 * Embeds the user question, searches Vectorize, assembles context, generates answer.
 */
import { Hono } from 'hono'
import type { Bindings } from '../index.ts'
import { embedQuery } from '../services/gemini-embed-service.ts'
import { searchVectorize } from '../services/vectorize-search-service.ts'
import { assembleContext } from '../services/context-assembler.ts'
import { generateAnswer } from '../services/gemini-generate-service.ts'

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

  const embedding = await embedQuery(query, c.env.GEMINI_API_KEY)
  const results = await searchVectorize(c.env.VECTORIZE, embedding, 5)
  const { contextText, citations } = assembleContext(results)
  const answer = await generateAnswer(query, contextText, c.env.GEMINI_API_KEY)

  return c.json({ answer, citations })
})
