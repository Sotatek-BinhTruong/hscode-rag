/**
 * Generates a RAG answer using Gemini 2.0 Flash via REST API.
 * Instructs the model to answer from context only and cite sources.
 */

const GENERATE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

const SYSTEM_PROMPT = `You are an expert on the ASEAN Harmonized Tariff Nomenclature (HSCode).
Your answers must be based ONLY on the provided context documents.
Rules:
- Cite each source using the exact label from context (e.g., [1] Chapter01.pdf, Page 1 — OXEN).
- When mentioning an HS code, use the exact format from context (e.g., 0102.29.11).
- If the answer is not in the context, say: "I could not find this information in the provided documents."
- Be concise and precise.`

export async function generateAnswer(
  query: string,
  contextText: string,
  apiKey: string
): Promise<string> {
  const prompt = `${SYSTEM_PROMPT}\n\n## Context Documents\n\n${contextText}\n\n## Question\n\n${query}`

  const res = await fetch(`${GENERATE_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,   // low temp for factual Q&A
        maxOutputTokens: 1024,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini generate failed ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  }

  return data.candidates[0]?.content?.parts[0]?.text ?? 'No response generated.'
}
