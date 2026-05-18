/**
 * Full-page chat layout: header, scrollable message list, input bar.
 */
import { useEffect, useRef } from 'react'
import { MessageBubble } from './message-bubble.tsx'
import { ChatInput } from './chat-input.tsx'
import { useChat } from '../hooks/use-chat.ts'

export function ChatWindow() {
  const { messages, loading, sendMessage } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="px-6 py-4 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <h1 className="text-lg font-semibold text-gray-800">HSCode Assistant</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          ASEAN Harmonized Tariff Nomenclature · Edition 2022
        </p>
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 space-y-3">
            <p className="text-4xl">📦</p>
            <p className="text-sm font-medium text-gray-500">Ask anything about HS codes</p>
            <p className="text-xs max-w-xs">
              Try: "What is 0102.29.11?" or "Find the HS code for breeding carp"
            </p>
          </div>
        )}
        {messages.map(m => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <ChatInput onSend={sendMessage} disabled={loading} />
    </div>
  )
}
