/**
 * Embeds a query using Cloudflare Workers AI (@cf/baai/bge-base-en-v1.5).
 * 768-dimensional output — matches the hscode-rag-index Vectorize configuration.
 * No geo-restrictions, runs natively on Cloudflare edge.
 */
import type { Ai } from '@cloudflare/workers-types'

export async function embedQuery(text: string, ai: Ai): Promise<number[]> {
  const result = await ai.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  }) as { data: number[][] }

  return result.data[0]
}
