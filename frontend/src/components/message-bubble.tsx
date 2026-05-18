/**
 * Renders a single chat message (user or assistant).
 * Assistant messages include collapsible citation cards below the answer.
 */
import { CitationCard } from './citation-card.tsx'
import type { Message } from '../types.ts'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className="max-w-[78%] space-y-2">
        {/* Message bubble */}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white rounded-tr-sm'
              : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
          }`}
        >
          {message.loading ? (
            <span className="flex items-center gap-2 text-gray-400">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
              Searching documents…
            </span>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>

        {/* Citation cards — only shown for assistant messages with citations */}
        {!message.loading && message.citations && message.citations.length > 0 && (
          <div className="space-y-1.5 ml-1">
            <p className="text-xs text-gray-400 px-1">Sources</p>
            {message.citations.map((c, i) => (
              <CitationCard
                key={`${c.document}-${c.pageNum}`}
                citation={c}
                index={i}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
