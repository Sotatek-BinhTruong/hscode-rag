/**
 * Keyword extraction and fuzzy matching for the lexical rerank pass.
 * BM25-inspired scoring over Vectorize metadata text (1500 chars per candidate).
 * Supports English and Vietnamese stopwords for ASEAN tariff queries.
 */

// ============================================================================
// Stopwords — English + Vietnamese
// ============================================================================

const STOPWORDS = new Set([
  // English
  'a','an','and','are','as','at','be','by','for','from','has','he','in','is',
  'it','its','of','on','that','the','to','was','were','will','with','what',
  'when','where','which','who','why','how','this','these','those','can','could',
  'should','would','may','might','must','shall','do','does','did','have','had',
  'having','been','being','i','you','we','they','me','him','her','us','them',
  'my','your','our','their','all','each','every','both','few','more','most',
  'other','some','such','no','nor','not','only','own','same','so','than','too',
  'very','just','also','now','here','there','then','if','or','but','about',
  'after','before','between','into','through','during','above','below','up',
  'down','out','off','over','under','again','further','once',
  // Vietnamese
  'cua','cac','nhung','tren','trong','theo','cho','ve','hay','la','mot',
  'nhieu','hang','va','hoac','khong','co','duoc','nay','do','gi','ma',
  'khi','neu','thi','voi','den','tu','sau','truoc','qua','nhu','tai',
])

// ============================================================================
// Keyword Extraction
// ============================================================================

export function extractKeywords(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  )]
}

// ============================================================================
// Levenshtein Distance — with early-exit optimisation
// ============================================================================

const MAX_FUZZY_DISTANCE = 2

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  if (Math.abs(a.length - b.length) > MAX_FUZZY_DISTANCE) return MAX_FUZZY_DISTANCE + 1

  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }
  return matrix[b.length][a.length]
}

// ============================================================================
// Fuzzy Match — check if any word in text is within edit distance of keyword
// ============================================================================

export function fuzzyMatch(text: string, keyword: string): boolean {
  const words = text.split(/\s+/)
  for (const word of words) {
    const clean = word.replace(/[^\w]/g, '').toLowerCase()
    if (clean.length < 3 || clean.length > keyword.length + MAX_FUZZY_DISTANCE + 2) continue
    if (levenshteinDistance(clean, keyword) <= MAX_FUZZY_DISTANCE) return true
  }
  return false
}

// ============================================================================
// Occurrence Count — capped to avoid over-rewarding repetition
// ============================================================================

export function countOccurrences(text: string, keyword: string, cap = 3): number {
  let count = 0
  let pos = 0
  while (count < cap) {
    pos = text.indexOf(keyword, pos)
    if (pos === -1) break
    count++
    pos += keyword.length
  }
  return count
}
