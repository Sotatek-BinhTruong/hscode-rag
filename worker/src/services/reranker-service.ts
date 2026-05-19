/**
 * Lexical reranker for Vectorize search candidates.
 * Combines vector cosine score + BM25-inspired keyword score + HS code exact-match boost.
 * RRF (Reciprocal Rank Fusion) used as tiebreaker between vector and lexical ranks.
 *
 * No second embedding call — pure in-memory scoring over metadata.text (1500 chars).
 */
import type { SearchResult } from './vectorize-search-service.ts'
import {
  fuzzyMatch,
  countOccurrences,
} from './keyword-search-service.ts'

const RRF_K = 60
const VECTOR_WEIGHT = 0.6
const KEYWORD_TEXT_SCORE = 0.10    // per keyword occurrence in text (capped at 3)
const KEYWORD_HEADING_SCORE = 0.20 // per keyword exact-match in heading
const FUZZY_SCORE = 0.05           // per keyword fuzzy-match in text
const HS_CODE_BOOST = 1.0          // per matching HS code in metadata (dominant signal)
const RRF_BLEND_WEIGHT = 0.05

export interface ScoredResult extends SearchResult {
  vectorScore: number
  lexicalScore: number
  hsCodeBoost: number
  finalScore: number
}

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank)
}

function computeLexicalScore(candidate: SearchResult, keywords: string[]): number {
  if (keywords.length === 0) return 0

  const textLower = candidate.text.toLowerCase()
  const headingLower = candidate.heading.toLowerCase()
  let score = 0

  for (const kw of keywords) {
    const occurrences = countOccurrences(textLower, kw)
    if (occurrences > 0) {
      score += KEYWORD_TEXT_SCORE * occurrences
    } else if (fuzzyMatch(textLower, kw)) {
      score += FUZZY_SCORE
    }

    if (headingLower.includes(kw)) {
      score += KEYWORD_HEADING_SCORE
    }
  }

  return score
}

function computeHsCodeBoost(candidate: SearchResult, queryHsCodes: string[]): number {
  if (queryHsCodes.length === 0) return 0
  const matches = queryHsCodes.filter(code => candidate.hsCodes.includes(code))
  return matches.length * HS_CODE_BOOST
}

export function rerankCandidates(params: {
  queryHsCodes: string[]
  keywords: string[]
  candidates: SearchResult[]
}): ScoredResult[] {
  const { queryHsCodes, keywords, candidates } = params

  if (candidates.length === 0) return []

  // Compute per-candidate lexical and HS boost scores
  const withScores = candidates.map(c => ({
    candidate: c,
    lexicalScore: computeLexicalScore(c, keywords),
    hsCodeBoost: computeHsCodeBoost(c, queryHsCodes),
  }))

  // Derive rank arrays for RRF: by vector score (original order) and by lexical score
  const vectorRanked = [...candidates].sort((a, b) => b.score - a.score)
  const lexicalRanked = [...withScores].sort((a, b) => b.lexicalScore - a.lexicalScore)

  const vectorRankMap = new Map(vectorRanked.map((c, i) => [c.id, i]))
  const lexicalRankMap = new Map(lexicalRanked.map(({ candidate }, i) => [candidate.id, i]))

  const scored: ScoredResult[] = withScores.map(({ candidate, lexicalScore, hsCodeBoost }) => {
    const vectorRank = vectorRankMap.get(candidate.id) ?? candidates.length
    const lexicalRank = lexicalRankMap.get(candidate.id) ?? candidates.length
    const rrfBlend = (rrfScore(vectorRank) + rrfScore(lexicalRank)) * RRF_BLEND_WEIGHT

    const finalScore =
      VECTOR_WEIGHT * candidate.score +
      lexicalScore +
      hsCodeBoost +
      rrfBlend

    return {
      ...candidate,
      vectorScore: candidate.score,
      lexicalScore,
      hsCodeBoost,
      finalScore,
    }
  })

  return scored.sort((a, b) => b.finalScore - a.finalScore)
}
