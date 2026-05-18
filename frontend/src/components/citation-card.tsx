/**
 * Collapsible card showing a single citation source reference.
 * Displays document, page, heading, HS codes, and relevance score.
 */
import { useState } from 'react'
import type { Citation } from '../types.ts'

interface Props {
  citation: Citation
  index: number
}

export function CitationCard({ citation, index }: Props) {
  const [open, setOpen] = useState(false)
  const relevancePct = Math.round(citation.score * 100)

  return (
    <div className="border border-gray-200 rounded-lg text-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="font-medium text-gray-700 truncate mr-2">
          [{index + 1}] {citation.document} — Page {citation.pageNum}
          {citation.heading ? ` · ${citation.heading}` : ''}
        </span>
        <span className="text-xs text-gray-400 shrink-0">
          {relevancePct}% {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="px-3 py-2 bg-white space-y-1.5 text-gray-600 border-t border-gray-100">
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500 w-20 shrink-0">Chapter</span>
            <span>{citation.chapterNum === 0 ? 'Introduction' : `Chapter ${citation.chapterNum}`}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500 w-20 shrink-0">Page</span>
            <span>{citation.pageNum}</span>
          </div>
          {citation.hsCodes.length > 0 && (
            <div className="flex gap-2">
              <span className="font-semibold text-gray-500 w-20 shrink-0">HS Codes</span>
              <div className="flex flex-wrap gap-1">
                {citation.hsCodes.map(code => (
                  <code
                    key={code}
                    className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs font-mono"
                  >
                    {code}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
