/**
 * Main ingestion CLI: PDF → PageIndex → Cloudflare Workers AI embeddings → Vectorize.
 * Uses @cf/baai/bge-base-en-v1.5 (768 dims) via Workers AI REST API.
 *
 * Usage:
 *   cp ../.env.example .env && edit .env
 *   npm run ingest
 *   npm run ingest:dry   # parse only, skip embedding + upload
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { parseDatasetDir } from './pdf-page-parser.ts'
import { buildPageIndex, type PageIndexNode } from './page-indexer.ts'
import { buildContextualText } from './contextual-text-builder.ts'
import { uploadToVectorize } from './vectorize-uploader.ts'

// ESM __dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATASET_DIR = path.resolve(__dirname, '../dataset')

// Workers AI REST API — no geo-restrictions, same model used by the Worker at query time
const EMBED_DELAY_MS = 100  // Workers AI has generous rate limits

const isDryRun = process.argv.includes('--dry-run')

async function embedText(text: string): Promise<number[]> {
  const accountId = process.env.CF_ACCOUNT_ID
  const apiToken = process.env.CF_API_TOKEN
  if (!accountId || !apiToken) throw new Error('CF_ACCOUNT_ID or CF_API_TOKEN not set')

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-base-en-v1.5`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: [text] }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Workers AI embed error ${res.status}: ${err}`)
  }

  const data = await res.json() as { result: { data: number[][] } }
  return data.result.data[0]
}

function validateEnv(): void {
  const required = ['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_VECTORIZE_INDEX']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}\nCopy .env.example → .env and fill in values.`)
  }
}

async function main(): Promise<void> {
  // Load .env file if present (scripts/.env)
  const { default: dotenv } = await import('dotenv')
  dotenv.config({ path: path.resolve(__dirname, '.env') })

  if (!isDryRun) validateEnv()

  // Step 1: Parse all PDF pages
  console.log(`\n📂 Parsing PDFs from ${DATASET_DIR} ...`)
  const rawPages = parseDatasetDir(DATASET_DIR)
  console.log(`   Found ${rawPages.length} pages`)

  // Step 2: Build PageIndex
  const nodes: PageIndexNode[] = buildPageIndex(rawPages)
  console.log(`\n📋 PageIndex built: ${nodes.length} nodes`)

  // Preview first few nodes with contextual text sample
  nodes.slice(0, 3).forEach(n => {
    console.log(`   [${n.id}] "${n.heading}" — HS: ${n.hsCodes.slice(0, 2).join(', ')}`)
    console.log(`   Contextual preview: ${buildContextualText(n).slice(0, 120).replace(/\n/g, '\\n')}`)
  })

  if (isDryRun) {
    console.log('\n⚠️  Dry run — skipping embedding and Vectorize upload')
    console.log(`   Would embed ${nodes.length} nodes and upload to: ${process.env.CF_VECTORIZE_INDEX ?? 'hscode-rag-index'}`)
    return
  }

  // Step 3: Embed all nodes
  console.log(`\n🔢 Embedding ${nodes.length} nodes with @cf/baai/bge-base-en-v1.5 (768 dims)...`)
  const embeddings: number[][] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    // Build contextual text: metadata prefix + page body, capped at 2000 chars
    const textToEmbed = buildContextualText(node)
    const embedding = await embedText(textToEmbed)
    embeddings.push(embedding)

    process.stdout.write(`\r   ${i + 1}/${nodes.length} embedded`)

    // Rate-limit guard: skip delay after last item
    if (i < nodes.length - 1) {
      await sleep(EMBED_DELAY_MS)
    }
  }
  console.log('\n   ✓ All embeddings ready')

  // Step 4: Upload to Cloudflare Vectorize
  console.log(`\n☁️  Uploading to Cloudflare Vectorize (index: ${process.env.CF_VECTORIZE_INDEX}) ...`)
  await uploadToVectorize(nodes, embeddings, {
    accountId: process.env.CF_ACCOUNT_ID!,
    apiToken: process.env.CF_API_TOKEN!,
    indexName: process.env.CF_VECTORIZE_INDEX!,
  })

  console.log(`\n✅ Ingestion complete — ${nodes.length} vectors in Cloudflare Vectorize`)
  console.log('   Verify: cd worker && npx wrangler vectorize info hscode-rag-index')
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
