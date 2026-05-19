/**
 * Assembles RAG context string and citation list from Vectorize search results.
 * Deduplicates by document+heading, filters low-confidence results, adds scorePct.
 */
import type { SearchResult } from './vectorize-search-service.ts'

const SCORE_THRESHOLD = 0.45

export interface Citation {
  document: string
  chapterNum: number
  pageNum: number
  heading: string
  hsCodes: string[]
  score: number
  scorePct: number
}

export interface AssembledContext {
  contextText: string
  citations: Citation[]
}

/** Drop results below cosine threshold. Always keeps at least top-1 to avoid empty context. */
function filterByScoreThreshold(results: SearchResult[]): SearchResult[] {
  const filtered = results.filter(r => r.score >= SCORE_THRESHOLD)
  return filtered.length > 0 ? filtered : results.slice(0, 1)
}

/** Collapse entries with identical document+heading. Keeps highest score; merges HS codes. */
function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>()
  for (const r of results) {
    const key = `${r.document}::${r.heading}`
    const existing = seen.get(key)
    if (!existing || r.score > existing.score) {
      seen.set(key, {
        ...r,
        hsCodes: existing
          ? [...new Set([...existing.hsCodes, ...r.hsCodes])]
          : [...r.hsCodes],
      })
    } else {
      seen.set(key, { ...existing, hsCodes: [...new Set([...existing.hsCodes, ...r.hsCodes])] })
    }
  }
  return [...seen.values()]
}

export function assembleContext(results: SearchResult[]): AssembledContext {
  const filtered = filterByScoreThreshold(results)
  const deduped = dedupeResults(filtered)

  const citations: Citation[] = []
  const blocks: string[] = []

  deduped.forEach((r, i) => {
    const scorePct = Math.round(r.score * 100)
    const sourceLabel = `[${i + 1}] ${r.document}, Page ${r.pageNum}${r.heading ? ` — ${r.heading}` : ''} (relevance ${scorePct}%)`
    const hsLine = r.hsCodes.length ? `HS Codes: ${r.hsCodes.join(', ')}\n` : ''

    blocks.push(`${sourceLabel}\n${hsLine}${r.text}`)

    citations.push({
      document: r.document,
      chapterNum: r.chapterNum,
      pageNum: r.pageNum,
      heading: r.heading,
      hsCodes: r.hsCodes,
      score: r.score,
      scorePct,
    })
  })

  return {
    contextText: blocks.join('\n\n---\n\n'),
    citations,
  }
}
