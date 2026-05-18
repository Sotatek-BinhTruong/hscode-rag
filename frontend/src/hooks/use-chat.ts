/**
 * Manages chat state and communicates with the Worker /query endpoint.
 * In dev: Vite proxy forwards /query → localhost:8787.
 * In prod: requests go to VITE_API_URL (defaults to same origin on Cloudflare Pages).
 */
import { useState, useCallback } from 'react'
import type { Message, Citation } from '../types.ts'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

interface QueryResponse {
  answer: string
  citations: Citation[]
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  const sendMessage = useCallback(async (query: string) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
    }
    const pendingId = crypto.randomUUID()
    const pendingMsg: Message = {
      id: pendingId,
      role: 'assistant',
      content: '',
      loading: true,
    }

    setMessages(prev => [...prev, userMsg, pendingMsg])
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      if (!res.ok) {
        throw new Error(`Server error ${res.status}`)
      }

      const data: QueryResponse = await res.json()

      setMessages(prev =>
        prev.map(m =>
          m.id === pendingId
            ? { ...m, content: data.answer, citations: data.citations, loading: false }
            : m
        )
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setMessages(prev =>
        prev.map(m =>
          m.id === pendingId
            ? { ...m, content: `Error: ${message}`, loading: false }
            : m
        )
      )
    } finally {
      setLoading(false)
    }
  }, [])

  return { messages, loading, sendMessage }
}
