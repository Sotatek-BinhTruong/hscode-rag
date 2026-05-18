/**
 * Generates a RAG answer using Cloudflare Workers AI (Llama 3.3 70B).
 * No geo-restrictions, runs natively on Cloudflare edge.
 */
import type { Ai } from '@cloudflare/workers-types'

const SYSTEM_PROMPT = `You are an expert on the ASEAN Harmonized Tariff Nomenclature (HSCode).
Answer questions based ONLY on the provided context documents.
Rules:
- Cite each source using the label from context (e.g., [1] Chapter01.pdf, Page 1 — OXEN).
- When mentioning an HS code, use the exact format from context (e.g., 0102.29.11).
- If the answer is not in the context, say: "I could not find this information in the provided documents."
- Be concise and precise.`

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
