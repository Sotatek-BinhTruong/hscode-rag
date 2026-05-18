/**
 * Extracts raw text per page from PDF files using pdftotext CLI.
 * Requires poppler-utils installed: sudo apt install poppler-utils
 */
import { execSync } from 'child_process'
import { readdirSync } from 'fs'
import path from 'path'

export interface RawPage {
  filePath: string
  fileName: string
  pageNum: number  // 1-indexed physical page in PDF
  text: string
}

/** Parse all pages from a single PDF file. */
export function parsePdfPages(filePath: string): RawPage[] {
  const fileName = path.basename(filePath)
  const totalPages = getPdfPageCount(filePath)
  const pages: RawPage[] = []

  for (let p = 1; p <= totalPages; p++) {
    const text = execSync(
      `pdftotext -f ${p} -l ${p} -enc UTF-8 "${filePath}" -`,
      { encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }
    )
      .replace(/\f/g, '')   // strip form-feed chars
      .trim()

    pages.push({ filePath, fileName, pageNum: p, text })
  }

  return pages
}

/** Parse all PDFs in a directory, sorted alphabetically. */
export function parseDatasetDir(datasetDir: string): RawPage[] {
  const files = readdirSync(datasetDir)
    .filter(f => f.endsWith('.pdf'))
    .sort()
    .map(f => path.join(datasetDir, f))

  return files.flatMap(parsePdfPages)
}

function getPdfPageCount(filePath: string): number {
  const info = execSync(`pdfinfo "${filePath}"`, { encoding: 'utf-8' })
  const match = info.match(/Pages:\s+(\d+)/)
  if (!match) throw new Error(`Could not get page count for ${filePath}`)
  return parseInt(match[1], 10)
}
