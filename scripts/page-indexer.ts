/**
 * Builds PageIndex nodes from raw PDF pages.
 * Each node = one PDF page with extracted HS codes, heading, and text.
 * Continuation pages (no HS codes) inherit HS codes from the previous page.
 */
import type { RawPage } from './pdf-page-parser.ts'

export interface PageIndexNode {
  id: string           // e.g. "chapter01-p1"
  document: string     // e.g. "Chapter01.pdf"
  chapterNum: number   // 0 for Introduction
  pageNum: number      // physical page number in PDF (1-indexed)
  hsCodes: string[]    // e.g. ["0102.29.11", "0105.11.10"]
  heading: string      // e.g. "OXEN" — best descriptive label for this page
  text: string         // full page text for embedding
}

// HS code: 4 digits . 2 digits [ . 2 digits ] — e.g. 0102.29 or 0102.29.11
const HS_CODE_RE = /\b\d{4}\.\d{2}(?:\.\d{2})?\b/g

// ALL-CAPS heading: a line of uppercase letters, spaces, punctuation, min 3 chars
// Excludes pure digit/dot lines (HS codes) and "CHAPTER N" lines
const HEADING_RE = /^[A-Z][A-Z0-9\s,;()\-\/–.]+$/

const CHAPTER_HEADER_RE = /^CHAPTER\s+\d+$/i

export function buildPageIndex(rawPages: RawPage[]): PageIndexNode[] {
  const nodes: PageIndexNode[] = []
  let lastHsCodes: string[] = []

  for (const page of rawPages) {
    const hsCodes = extractHsCodes(page.text)
    const chapterNum = extractChapterNum(page.fileName)

    // Continuation page: inherit HS codes from previous entry
    const effectiveHsCodes = hsCodes.length > 0 ? hsCodes : [...lastHsCodes]
    if (hsCodes.length > 0) lastHsCodes = hsCodes

    const heading = extractHeading(page.text, effectiveHsCodes)

    nodes.push({
      id: buildNodeId(page.fileName, page.pageNum),
      document: page.fileName,
      chapterNum,
      pageNum: page.pageNum,
      hsCodes: effectiveHsCodes,
      heading,
      text: page.text,
    })
  }

  return nodes
}

function extractHsCodes(text: string): string[] {
  const matches = [...text.matchAll(HS_CODE_RE)].map(m => m[0])
  return [...new Set(matches)]
}

function extractHeading(text: string, hsCodes: string[]): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const hsCodeSet = new Set(hsCodes)
  const headingLines: string[] = []

  for (const line of lines) {
    // Skip chapter header, page numbers, HS code lines, source lines
    if (CHAPTER_HEADER_RE.test(line)) continue
    if (/^\d+$/.test(line)) continue          // page number
    if (/^\(Source:/.test(line)) continue      // source attribution
    if (/^Picture/.test(line)) continue        // picture captions
    if (hsCodeSet.has(line)) continue          // standalone HS code line

    if (HEADING_RE.test(line) && line.length >= 3) {
      headingLines.push(line)
      // Collect multi-line headings (consecutive ALL-CAPS lines)
      if (headingLines.length >= 3) break
    } else if (headingLines.length > 0) {
      // Stop at first non-caps line after we found a heading
      break
    }
  }

  if (headingLines.length > 0) {
    return headingLines.join(' ').slice(0, 150)
  }

  // Fallback: first HS code as label
  return hsCodes[0] ?? 'UNKNOWN'
}

function extractChapterNum(fileName: string): number {
  const match = fileName.match(/Chapter(\d+)/i)
  return match ? parseInt(match[1], 10) : 0
}

function buildNodeId(fileName: string, pageNum: number): string {
  return fileName.replace('.pdf', '').toLowerCase().replace(/\s+/g, '') + `-p${pageNum}`
}
