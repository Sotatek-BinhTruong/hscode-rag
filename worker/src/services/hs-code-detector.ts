/**
 * Extracts HS code patterns from a query string.
 * Used by the reranker to apply exact-match metadata boost.
 * Pattern: 4 digits . 2 digits [ . 2 digits ] — e.g. 0102.29 or 0102.29.11
 */
const HS_CODE_RE = /\b\d{4}\.\d{2}(?:\.\d{2})?\b/g

export function extractHsCodes(query: string): string[] {
  return [...new Set([...query.matchAll(HS_CODE_RE)].map(m => m[0]))]
}
