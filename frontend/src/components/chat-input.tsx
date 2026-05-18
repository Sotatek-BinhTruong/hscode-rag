/**
 * Textarea input with Send button for submitting queries.
 * Enter submits; Shift+Enter inserts a newline.
 */
import { useState, useRef } from 'react'

interface Props {
  onSend: (query: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    textareaRef.current?.focus()
  }

  return (
    <div className="flex gap-2 p-4 border-t border-gray-200 bg-white">
      <textarea
        ref={textareaRef}
        className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
        rows={2}
        placeholder='Ask about HS codes, e.g. "What is the HS code for breeding carp?"'
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        disabled={disabled}
      />
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-blue-700 active:bg-blue-800 transition-colors self-end"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
      >
        Send
      </button>
    </div>
  )
}
