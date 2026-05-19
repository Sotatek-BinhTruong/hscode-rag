/**
 * Generates a RAG answer using Cloudflare Workers AI (Llama 3.3 70B).
 * No geo-restrictions, runs natively on Cloudflare edge.
 */
import type { Ai } from '@cloudflare/workers-types'

const SYSTEM_PROMPT = `You are an expert on the ASEAN Harmonized Tariff Nomenclature (HSCode).
Answer questions based ONLY on the provided context documents.

Language: respond in the SAME language as the user's question. If the question is in Vietnamese, answer in Vietnamese; if English, answer in English.

Rules:
- Cite each source using the label from context (e.g., [1] Chapter01.pdf, Page 1 — OXEN).
- Always include the HS code(s) explicitly in your answer when available in the context (e.g., "HS Code: 0102.29.11").
- When mentioning an HS code, use the exact format from context (e.g., 0102.29.11).
- Be concise and precise.
- If the answer is not in the context, say:
  - English: "I could not find this information in the provided documents."
  - Vietnamese: "Tôi không tìm thấy thông tin này trong tài liệu được cung cấp."`

export async function generateAnswer(
  query: string,
  contextText: string,
  ai: Ai
): Promise<string> {
  const userMessage = `## Context Documents\n\n${contextText}\n\n## Question\n\n${query}`

  const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 1024,
  }) as { response?: string }

  return result.response ?? 'No response generated.'
}
