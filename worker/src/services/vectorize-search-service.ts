/**
 * Queries Cloudflare Vectorize index using a pre-computed embedding.
 * Returns structured SearchResult objects with citation metadata.
 */

export interface SearchResult {
  id: string
  score: number
  document: string
  chapterNum: number
  pageNum: number
  hsCodes: string[]
  heading: string
  text: string
}

export async function searchVectorize(
  vectorize: VectorizeIndex,
  embedding: number[],
  topK = 5
): Promise<SearchResult[]> {
  const results = await vectorize.query(embedding, {
    topK,
    returnMetadata: 'all',
  })

  return results.matches.map(match => ({
    id: match.id,
    score: match.score,
    document: String(match.metadata?.['document'] ?? ''),
    chapterNum: Number(match.metadata?.['chapterNum'] ?? 0),
    pageNum: Number(match.metadata?.['pageNum'] ?? 0),
    // hsCodes stored as comma-separated string in metadata
    hsCodes: String(match.metadata?.['hsCodes'] ?? '')
      .split(',')
      .filter(Boolean),
    heading: String(match.metadata?.['heading'] ?? ''),
    text: String(match.metadata?.['text'] ?? ''),
  }))
}
