/**
 * Builds contextual embedding text for a PageIndex node.
 * Prepends structured metadata (document, chapter, heading, HS codes, page) before
 * raw page text so bge-base-en-v1.5 encodes document-level context into the vector.
 *
 * Total output ≤ 2000 chars (safe window for ~512 tokens at avg 4 chars/token).
 * Prefix is kept ≤ 250 chars so raw content is not excessively truncated.
 */
import type { PageIndexNode } from './page-indexer.ts'

const MAX_TOTAL_CHARS = 2000
const MAX_PREFIX_CHARS = 250
// At most 8 HS codes in prefix to keep prefix compact
const MAX_HS_IN_PREFIX = 8

export function buildContextualText(node: PageIndexNode): string {
  const hsCodes = node.hsCodes.slice(0, MAX_HS_IN_PREFIX)
  const hsLabel = hsCodes.length > 0
    ? hsCodes.join(', ') + (node.hsCodes.length > MAX_HS_IN_PREFIX ? ', ...' : '')
    : 'none'

  const prefix = [
    `[Document: ${node.document}]`,
    `[Chapter: ${node.chapterNum}]`,
    `[Heading: ${node.heading}]`,
    `[HS Codes: ${hsLabel}]`,
    `[Page: ${node.pageNum}]`,
    '',
  ].join('\n').slice(0, MAX_PREFIX_CHARS)

  const bodyBudget = MAX_TOTAL_CHARS - prefix.length
  const body = node.text.slice(0, Math.max(0, bodyBudget))
  return prefix + body
}
