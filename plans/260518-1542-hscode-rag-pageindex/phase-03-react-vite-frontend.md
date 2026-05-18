# Phase 03: React + Vite Chat Frontend

## Overview

- **Priority:** Medium
- **Status:** pending
- **Depends on:** Phase 02 (Worker API must be running)
- **Goal:** Chat UI in React + Vite with citation cards, deployed to Cloudflare Pages.

## Key Insights

- SPA is sufficient — no SSR needed for a chat interface
- Vite dev proxy to worker avoids CORS issues during development
- Citations are collapsible cards below each assistant message
- No global state manager needed — `useChat` hook handles all chat state
- Tailwind CSS for styling (utility-first, minimal config)
- `VITE_API_URL` env var points to Worker URL (dev = localhost:8787, prod = Workers URL)

## Files Created in This Phase

```
frontend/
├── index.html
├── vite.config.ts
├── package.json
├── tsconfig.json
├── .env.example              # VITE_API_URL=http://localhost:8787
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── types.ts              # shared Message, Citation types
│   ├── hooks/
│   │   └── use-chat.ts       # chat state + API call
│   └── components/
│       ├── chat-window.tsx   # scrollable message list
│       ├── message-bubble.tsx # user / assistant message
│       ├── citation-card.tsx  # collapsible source reference
│       └── chat-input.tsx    # textarea + send button
```

## Types

```typescript
// src/types.ts
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
```

## Implementation Steps

### Step 1 — Scaffold with Vite

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

`tailwind.config.js`:
```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

### Step 2 — vite.config.ts (with dev proxy)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/query': 'http://localhost:8787',  // proxy to Worker in dev
    },
  },
})
```

### Step 3 — use-chat.ts hook

```typescript
// src/hooks/use-chat.ts
import { useState, useCallback } from 'react'
import type { Message, Citation } from '../types.ts'

const API_URL = import.meta.env.VITE_API_URL ?? ''

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)

  const sendMessage = useCallback(async (query: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: query }
    const pendingMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', loading: true }
    setMessages(prev => [...prev, userMsg, pendingMsg])
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json<{ answer: string; citations: Citation[] }>()

      setMessages(prev => prev.map(m =>
        m.id === pendingMsg.id
          ? { ...m, content: data.answer, citations: data.citations, loading: false }
          : m
      ))
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === pendingMsg.id
          ? { ...m, content: 'Error: Could not reach the server.', loading: false }
          : m
      ))
    } finally {
      setLoading(false)
    }
  }, [])

  return { messages, loading, sendMessage }
}
```

### Step 4 — citation-card.tsx

```tsx
// src/components/citation-card.tsx
import { useState } from 'react'
import type { Citation } from '../types.ts'

export function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const [open, setOpen] = useState(false)
  const relevance = Math.round(citation.score * 100)

  return (
    <div className="border border-gray-200 rounded-lg text-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="font-medium text-gray-700">
          [{index + 1}] {citation.document} — Page {citation.pageNum}
          {citation.heading ? ` · ${citation.heading}` : ''}
        </span>
        <span className="text-xs text-gray-400 ml-2">{relevance}% match {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 py-2 bg-white space-y-1 text-gray-600">
          <div><span className="font-semibold">Chapter:</span> {citation.chapterNum}</div>
          {citation.hsCodes.length > 0 && (
            <div>
              <span className="font-semibold">HS Codes: </span>
              {citation.hsCodes.map(code => (
                <code key={code} className="bg-blue-50 text-blue-700 px-1 rounded mr-1">{code}</code>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

### Step 5 — message-bubble.tsx

```tsx
// src/components/message-bubble.tsx
import { CitationCard } from './citation-card.tsx'
import type { Message } from '../types.ts'

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[75%] space-y-2`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white rounded-tr-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
        }`}>
          {message.loading ? (
            <span className="animate-pulse text-gray-400">Thinking…</span>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>
        {!message.loading && message.citations && message.citations.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-gray-400 px-1">Sources</p>
            {message.citations.map((c, i) => (
              <CitationCard key={c.document + c.pageNum} citation={c} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

### Step 6 — chat-input.tsx

```tsx
// src/components/chat-input.tsx
import { useState, useRef } from 'react'

interface Props {
  onSend: (query: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  return (
    <div className="flex gap-2 p-4 border-t border-gray-200 bg-white">
      <textarea
        className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        rows={2}
        placeholder="Ask about HS codes, e.g. "What is the HS code for breeding carp?""
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
        disabled={disabled}
      />
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
      >
        Send
      </button>
    </div>
  )
}
```

### Step 7 — chat-window.tsx

```tsx
// src/components/chat-window.tsx
import { useEffect, useRef } from 'react'
import { MessageBubble } from './message-bubble.tsx'
import { ChatInput } from './chat-input.tsx'
import { useChat } from '../hooks/use-chat.ts'

export function ChatWindow() {
  const { messages, loading, sendMessage } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-800">HSCode Assistant</h1>
        <p className="text-xs text-gray-400">ASEAN Harmonized Tariff Nomenclature · Edition 2022</p>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-20">
            Ask anything about HS codes, e.g. "What is 0102.29.11?"
          </p>
        )}
        {messages.map(m => <MessageBubble key={m.id} message={m} />)}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSend={sendMessage} disabled={loading} />
    </div>
  )
}
```

### Step 8 — App.tsx & main.tsx

```tsx
// src/App.tsx
import { ChatWindow } from './components/chat-window.tsx'
export default function App() { return <ChatWindow /> }

// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Step 9 — Local dev test

```bash
# Terminal 1: Worker
cd worker && npx wrangler dev

# Terminal 2: Frontend (proxies /query to :8787)
cd frontend && npm run dev
# Open http://localhost:5173
```

Test queries:
- "What is the HS code for oxen?"
- "Tell me about breeding carp classification"
- "What HS codes are for limes?"

## Todo

- [ ] `npm create vite@latest` in frontend/
- [ ] Install Tailwind CSS
- [ ] Configure vite.config.ts with dev proxy
- [ ] Define `types.ts` (Message, Citation)
- [ ] Implement `use-chat.ts` hook
- [ ] Implement `citation-card.tsx`
- [ ] Implement `message-bubble.tsx`
- [ ] Implement `chat-input.tsx`
- [ ] Implement `chat-window.tsx`
- [ ] Wire up `App.tsx` + `main.tsx`
- [ ] Test locally with wrangler dev + Vite dev server
- [ ] Verify citation cards expand with correct chapter/page/HS codes

## Success Criteria

- Chat sends query and displays answer with citation cards
- Citations show document, page, heading, HS codes
- Pressing Enter (without Shift) submits query
- Loading state shows "Thinking…" while waiting
- Auto-scrolls to latest message

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| CORS issue in dev | Vite proxy forwards `/query` to Worker — no CORS needed in dev |
| Long answers overflow bubble | `whitespace-pre-wrap` + `max-w-[75%]` constrains width |
| Citation score as decimal (0.92) | Format as `Math.round(score * 100)%` |
