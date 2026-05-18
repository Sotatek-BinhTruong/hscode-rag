/** Shared types for chat messages and citation references. */

export interface Citation {
  document: string
  chapterNum: number
  pageNum: number
  heading: string
  hsCodes: string[]
  score: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  loading?: boolean
}
