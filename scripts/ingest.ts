/**
 * Main ingestion CLI: PDF → PageIndex → Gemini embeddings → Cloudflare Vectorize.
 *
 * Usage:
 *   cp ../.env.example .env && edit .env
 *   npm run ingest
 *   npm run ingest:dry   # parse + embed only, skip Vectorize upload
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { parseDatasetDir } from './pdf-page-parser.ts'
import { buildPageIndex, type PageIndexNode } from './page-indexer.ts'
import { uploadToVectorize } from './vectorize-uploader.ts'

// ESM __dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATASET_DIR = path.resolve(__dirname, '../dataset')

// Gemini API: delay between embed calls to respect free-tier rate limit (~100 req/min)
const EMBED_DELAY_MS = 650
const GEMINI_EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

const isDryRun = process.argv.includes('--dry-run')

async function embedText(text: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in environment')

  const res = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: 768,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini embed error ${res.status}: ${err}`)
  }

  const data = await res.json() as { embedding: { values: number[] } }
  return data.embedding.values
}

function validateEnv(): void {
  const required = ['GEMINI_API_KEY', 'CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_VECTORIZE_INDEX']
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

  // Preview first few nodes
  nodes.slice(0, 3).forEach(n => {
    console.log(`   [${n.id}] "${n.heading}" — HS: ${n.hsCodes.slice(0, 2).join(', ')}`)
  })

  if (isDryRun) {
    console.log('\n⚠️  Dry run — skipping embedding and Vectorize upload')
    console.log(`   Would embed ${nodes.length} nodes and upload to: ${process.env.CF_VECTORIZE_INDEX ?? 'hscode-rag-index'}`)
    return
  }

  // Step 3: Embed all nodes
  console.log(`\n🔢 Embedding ${nodes.length} nodes with gemini-embedding-001 (768 dims)...`)
  const embeddings: number[][] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    // Use first 4000 chars for embedding (API input limit)
    const textToEmbed = node.text.slice(0, 4000)
    const embedding = await embedText(textToEmbed, 'RETRIEVAL_DOCUMENT')
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
