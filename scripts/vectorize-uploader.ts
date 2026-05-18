/**
 * Uploads PageIndex nodes with embeddings to Cloudflare Vectorize via REST API v2.
 * Uses NDJSON format (one JSON object per line) as required by v2 insert endpoint.
 */
import type { PageIndexNode } from './page-indexer.ts'

export interface VectorizeConfig {
  accountId: string
  apiToken: string
  indexName: string
}

interface VectorRecord {
  id: string
  values: number[]
  metadata: Record<string, string | number>
}

const BATCH_SIZE = 100  // Vectorize max vectors per insert request

export async function uploadToVectorize(
  nodes: PageIndexNode[],
  embeddings: number[][],
  config: VectorizeConfig
): Promise<void> {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/vectorize/v2/indexes/${config.indexName}`

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batchNodes = nodes.slice(i, i + BATCH_SIZE)
    const batchEmbeds = embeddings.slice(i, i + BATCH_SIZE)

    const records: VectorRecord[] = batchNodes.map((node, j) => ({
      id: node.id,
      values: batchEmbeds[j],
      metadata: {
        document: node.document,
        chapterNum: node.chapterNum,
        pageNum: node.pageNum,
        hsCodes: node.hsCodes.join(','),
        heading: node.heading,
        // Truncate text to stay within 10KB metadata limit per vector
        text: node.text.slice(0, 1500),
      },
    }))

    // Vectorize v2 uses NDJSON: one JSON object per line
    const ndjson = records.map(r => JSON.stringify(r)).join('\n')

    const res = await fetch(`${baseUrl}/insert`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Vectorize insert failed (batch ${i + 1}–${i + batchNodes.length}): ${error}`)
    }

    const result = await res.json() as { result: { mutationId: string } }
    console.log(`✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${batchNodes.length} vectors (mutation: ${result.result?.mutationId ?? 'n/a'})`)
  }
}
