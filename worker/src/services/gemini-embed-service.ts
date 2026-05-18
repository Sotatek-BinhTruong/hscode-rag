/**
 * Embeds a user query using Gemini embedding-001 via REST API.
 * Uses fetch (native in Workers) — no SDK needed.
 * outputDimensionality=768 matches the Vectorize index dimension.
 */

const EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch(`${EMBED_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 768,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini embed failed ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { embedding: { values: number[] } }
  return data.embedding.values
}
