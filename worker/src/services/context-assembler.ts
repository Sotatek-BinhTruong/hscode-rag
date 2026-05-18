/**
 * Assembles RAG context string and citation list from Vectorize search results.
 * Context is formatted to help Gemini cite sources accurately.
 */
import type { SearchResult } from './vectorize-search-service.ts'

export interface Citation {
  document: string
  chapterNum: number
  pageNum: number
  heading: string
  hsCodes: string[]
  score: number
}

export interface AssembledContext {
  contextText: string
  citations: Citation[]
}

export function assembleContext(results: SearchResult[]): AssembledContext {
  const citations: Citation[] = []
  const blocks: string[] = []

  results.forEach((r, i) => {
    const sourceLabel = `[${i + 1}] ${r.document}, Page ${r.pageNum}${r.heading ? ` — ${r.heading}` : ''}`
    const hsLine = r.hsCodes.length ? `HS Codes: ${r.hsCodes.join(', ')}\n` : ''

    blocks.push(`${sourceLabel}\n${hsLine}${r.text}`)

    citations.push({
      document: r.document,
      chapterNum: r.chapterNum,
      pageNum: r.pageNum,
      heading: r.heading,
      hsCodes: r.hsCodes,
      score: r.score,
    })
  })

  return {
    contextText: blocks.join('\n\n---\n\n'),
    citations,
  }
}
