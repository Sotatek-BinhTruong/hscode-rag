# Deployment Guide

Complete guide to deploy HSCode RAG across development and production environments. This covers infrastructure setup, ingestion pipeline, Worker deployment, and frontend hosting.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Cloudflare Infrastructure](#cloudflare-infrastructure)
4. [Data Ingestion Pipeline](#data-ingestion-pipeline)
5. [Worker Deployment](#worker-deployment)
6. [Frontend Deployment](#frontend-deployment)
7. [Testing & Validation](#testing--validation)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Node.js:** v18+ (check with `node --version`)
- **npm:** v8+ or equivalent package manager
- **pdftotext:** poppler-utils utility for PDF text extraction

Install pdftotext:
```bash
# macOS
brew install poppler

# Ubuntu/Debian
sudo apt-get install poppler-utils

# Fedora
sudo dnf install poppler-utils
```

### Accounts & APIs

1. **Cloudflare Account** with:
   - Workers AI enabled
   - Vectorize enabled
   - API token with permissions: `Workers AI:Read`, `Workers Scripts:Edit`, `Cloudflare Vectorize:Edit`

2. **GitHub Account** (for Pages auto-deployment, optional)

### CLI Tools

```bash
# Install Wrangler (Cloudflare Workers CLI)
npm install -g wrangler
# Or use npx to skip global install: npx wrangler ...

# Verify installation
wrangler --version
```

## Environment Setup

### 1. Create Cloudflare API Token

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Account Settings** → **API Tokens**
3. Click **Create Token**
4. Use template **Edit Cloudflare Workers** (includes Vectorize permissions)
5. Optionally restrict to specific accounts/IPs
6. Copy token and save safely (shown only once)

### 2. Find Cloudflare Account ID

```bash
wrangler whoami
# Output includes account details

# Or from Dashboard: Account Settings → General → Account ID
```

### 3. Configure Environment Variables

Copy and fill `.env.example`:
```bash
cd /path/to/hscode-rag/scripts
cp .env.example .env
```

Edit `scripts/.env`:
```
CF_ACCOUNT_ID=<your-cloudflare-account-id>
CF_API_TOKEN=<api-token-with-workers-ai-and-vectorize-permissions>
CF_VECTORIZE_INDEX=hscode-rag-index
```

> **Important:** The API token must have `Workers AI:Read` + `Cloudflare Vectorize:Edit` + `Workers Scripts:Edit` permissions. Standard "Edit Cloudflare Workers" template does NOT include Workers AI — you must add it manually.

**Security:** Never commit `.env` files to git. Use `.env.example` with placeholder values only.

## Cloudflare Infrastructure

### 1. Create Vectorize Index

The vector database stores page embeddings. Create a 768-dimensional cosine similarity index:

```bash
# Create index
wrangler vectorize create hscode-rag-index --dimensions=768 --metric=cosine

# Verify creation
wrangler vectorize describe hscode-rag-index

# List all indexes
wrangler vectorize list
```

**Output:**
```
✓ Created Vectorize Index 'hscode-rag-index'
  - Dimensions: 768
  - Metric: cosine
```

### 2. Verify Workers AI Access

Cloudflare Workers AI is embedded in the Worker runtime (no separate setup needed), but it requires Workers AI to be enabled on your account:

```bash
# Test Workers AI via wrangler (optional)
wrangler ai help
```

### 3. Configure wrangler.toml

The Worker configuration is already set up in `worker/wrangler.toml`:

```toml
name = "hscode-rag-worker"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]
account_id = "..."  # Replace with your account ID

[[vectorize]]
binding = "VECTORIZE"
index_name = "hscode-rag-index"

[ai]
binding = "AI"
```

Verify `account_id` matches your Cloudflare account:
```bash
cd worker
wrangler whoami
```

## Data Ingestion Pipeline

The ingestion pipeline parses PDFs, extracts HS codes and headings, embeds pages, and uploads vectors to Vectorize.

### 1. Prepare Dataset

Place all chapter PDFs in `dataset/` directory:
```
dataset/
├── Chapter01.pdf
├── Chapter02.pdf
├── ... 
└── Chapter13.pdf
```

### 2. Install Ingestion Dependencies

```bash
cd scripts
npm install
```

### 3. Run Ingestion Pipeline

#### Dry Run (Parse Only, No Upload)

Test the pipeline without touching Vectorize:

```bash
npm run ingest:dry
```

**Output:**
```
📂 Parsing PDFs from /path/to/dataset ...
   Found 500 pages

📋 PageIndex built: 500 nodes
   [chapter01-p1] "OXEN" — HS: 0102.29.11, 0102.29.12
   [chapter01-p2] "PIGS" — HS: 0103.10.10, 0103.20.10
   [chapter01-p3] "SHEEP" — HS: 0104.10.10, 0104.20.10

⚠️  Dry run — skipping embedding and Vectorize upload
   Would embed 500 nodes and upload to: hscode-rag-index
```

#### Full Ingestion (Parse → Embed → Upload)

Run the complete pipeline with embedding and upload:

```bash
npm run ingest
```

**What happens:**
1. **Parse:** Extract text from each PDF page via `pdftotext`
2. **Index:** Extract HS codes, chapter numbers, headings per page
3. **Embed:** Call Workers AI REST API `@cf/baai/bge-base-en-v1.5` per page (768 dims, 100ms delay between calls)
4. **Upload:** Batch upsert vectors to Vectorize (100 per batch, NDJSON format)

**Estimated time:** ~2 minutes for 61 pages (100ms/request rate-limit guard)

**Sample output:**
```
📂 Parsing PDFs from .../dataset ...
   Found 61 pages

📋 PageIndex built: 61 nodes
   [chapter01-p1] "OXEN" — HS: 0102.29.11
   [chapter01-p2] "BREEDING" — HS: 0105.11.10, 0105.94.10

🔢 Embedding 61 nodes with @cf/baai/bge-base-en-v1.5 (768 dims)...
   61/61 embedded
   ✓ All embeddings ready

☁️  Uploading to Cloudflare Vectorize (index: hscode-rag-index) ...
✓ Batch 1: inserted 61 vectors

✅ Ingestion complete — 61 vectors in Cloudflare Vectorize
```

#### Resume After Interruption

If ingestion fails partway through, check which vectors were uploaded:

```bash
wrangler vectorize describe hscode-rag-index
# Shows count of uploaded vectors
```

Modify `ingest.ts` to skip already-uploaded pages and resume. Or restart fresh (Vectorize upsert is idempotent by ID).

### 4. Verify Ingestion

Test that vectors are searchable:

```bash
# Run a test query
curl -X POST https://hscode-rag-worker.<account>.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the HS code for oxen?"}'
```

## Worker Deployment

Deploy the Hono API to Cloudflare Workers.

### 1. Install Worker Dependencies

```bash
cd worker
npm install
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
# Opens browser for OAuth. Approve and return to terminal.
```

Or use API token (non-interactive):

```bash
export CLOUDFLARE_API_TOKEN=<your-api-token>
wrangler deploy
```

### 3. Deploy to Workers

```bash
cd worker
npm run deploy
```

**Output:**
```
✓ Uploaded hscode-rag-worker
  https://hscode-rag-worker.cb55ddfe513e9669cdbbf345a59ad54e.workers.dev

✨ Deployment complete! Visit your Worker at:
   https://hscode-rag-worker.<account>.workers.dev
```

### 4. Test Worker Endpoints

Test the health endpoint:
```bash
curl https://hscode-rag-worker.<account>.workers.dev/health
# Response: {"status":"ok","timestamp":1234567890}
```

Test the query endpoint:
```bash
curl -X POST https://hscode-rag-worker.<account>.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the HS code for live oxen?"}'

# Response:
# {
#   "answer": "The HS code for live oxen is 0102.29.11 [1]...",
#   "citations": [...]
# }
```

### 5. View Worker Logs

```bash
wrangler tail hscode-rag-worker
# Streams real-time logs from Worker execution
```

## Frontend Deployment

Deploy the React UI to Cloudflare Pages.

### 1. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 2. Build Locally (Optional)

```bash
npm run build
# Outputs to dist/
```

### 3. Option A: Auto-Deploy via GitHub

**Setup:**
1. Push code to GitHub repository
2. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
3. Go to **Pages** → **Create project** → **Connect to Git**
4. Select repository and main branch
5. Build settings: Framework = **Vite**, command = **npm run build**
6. Set environment variable: `VITE_API_URL=https://hscode-rag-worker.<account>.workers.dev`
7. Deploy

**On each push:**
- Cloudflare automatically builds and deploys the latest code
- Site available at `hscode-rag.<account>.pages.dev`

### 4. Option B: Manual Deploy

```bash
cd frontend
npm install
npm run build

# Deploy dist/ folder
wrangler pages deploy dist
```

### 5. Configure API URL

The frontend needs to know the Worker API endpoint. Set in Cloudflare Pages environment:

**Dashboard → Pages → Settings → Environment variables**

Add:
```
VITE_API_URL = https://hscode-rag-worker.<account>.workers.dev
```

Or during local development, set in `.env.local`:
```
VITE_API_URL=http://localhost:8787
```

## Testing & Validation

### Unit Tests (Worker)

```bash
cd worker
npm run test  # If test script exists
```

### Integration Tests

Test the complete query flow:

```bash
# Test with curl
curl -X POST https://hscode-rag-worker.<account>.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is HS code 0102.29.11?"}'

# Expected: Answer about live cattle with citations
```

### Load Testing

Test API performance under load (optional):

```bash
# Using Apache Bench
ab -n 100 -c 10 https://hscode-rag-worker.<account>.workers.dev/health

# Using hey (https://github.com/rakyll/hey)
hey -n 100 -c 10 -m POST \
  -H "Content-Type: application/json" \
  -d '{"query": "HS code for oxen"}' \
  https://hscode-rag-worker.<account>.workers.dev/query
```

## Troubleshooting

### "Vectorize index not found"

```
Error: Vectorize index 'hscode-rag-index' not found
```

**Solution:**
```bash
# Verify index exists
wrangler vectorize list

# Create if missing
wrangler vectorize create hscode-rag-index --dimensions=768 --metric=cosine

# Update wrangler.toml with correct index_name
```

### "Workers AI embed error 401: Authentication error"

```
Workers AI embed error 401: {"code":10000,"message":"Authentication error"}
```

**Solution:**
1. Verify `CF_API_TOKEN` in `scripts/.env` is correct
2. Token must have **Workers AI:Read** permission — standard "Edit Cloudflare Workers" template does NOT include it
3. Go to Cloudflare Dashboard → My Profile → API Tokens → edit token → add `Workers AI:Read`
4. Save updated token back to `scripts/.env`

### "Worker deployment fails with auth error"

```
Error: Missing authentication. Run 'wrangler login'
```

**Solution:**
```bash
wrangler logout
wrangler login
# Or use API token:
export CLOUDFLARE_API_TOKEN=<token>
wrangler deploy
```

### "pdftotext command not found"

```
Error: pdftotext not found
```

**Solution:**
```bash
# Install poppler-utils for your OS (see Prerequisites section)
sudo apt-get install poppler-utils  # Ubuntu
brew install poppler                # macOS
```

### Ingestion hangs or times out

**Possible causes:**
- Workers AI rate limiting
- Large PDF files
- Network issues

**Solutions:**
1. Increase delay between requests in `ingest.ts`: `const EMBED_DELAY_MS = 200`
2. Check Workers AI usage limits in Cloudflare Dashboard
3. Split PDFs into smaller files if pages > 1000

### Query returns empty results

```json
{
  "answer": "I could not find this information in the provided documents.",
  "citations": []
}
```

**Causes:**
- Ingestion incomplete or failed
- Query doesn't match document content well
- Vector search not finding relevant pages

**Diagnosis:**
```bash
# Check vector count
wrangler vectorize describe hscode-rag-index

# Run dry-run parse to verify dataset
cd scripts && npm run ingest:dry

# Test embedding service directly (in Node)
const result = await embedQuery("oxen");
console.log(result.length); // Should be 768
```

### CORS errors in browser

```
Access to XMLHttpRequest blocked by CORS policy
```

**Solution:**
- Verify Worker CORS config in `src/index.ts`
- Allowed origins: `http://localhost:*`, `*.pages.dev`
- If using custom domain, update CORS allowlist
- Check frontend `VITE_API_URL` matches deployment domain

### Frontend shows "API connection failed"

**Steps:**
1. Verify Worker is deployed: `wrangler deploy`
2. Test Worker manually: `curl https://hscode-rag-worker.<account>.workers.dev/health`
3. Check frontend environment variables in Pages dashboard
4. Check browser console for CORS errors
5. Verify VITE_API_URL is correct (with https://)

## Rollback & Disaster Recovery

### Rollback Worker to Previous Version

```bash
# View deployment history
wrangler deployments list

# Rollback to specific deployment
wrangler rollback --message "Rollback to stable version"
```

### Restore Vectorize Index

```bash
# Vectorize stores snapshots (check Cloudflare docs)
# If index corrupted, delete and re-ingest:
wrangler vectorize delete hscode-rag-index
wrangler vectorize create hscode-rag-index --dimensions=768 --metric=cosine
cd scripts && npm run ingest
```

### Rollback Frontend (Pages)

1. Dashboard → Pages → hscode-rag
2. Deployments tab
3. Select previous deployment, click "Rollback"

## Monitoring & Observability

### View Worker Logs

```bash
wrangler tail hscode-rag-worker

# Filter by level
wrangler tail hscode-rag-worker --status ok,error
```

### Monitor Vectorize Usage

Dashboard → Vectorize → hscode-rag-index
- Vector count
- Query count
- Storage usage

### Set Up Error Alerts

Use Cloudflare Logpush or external monitoring (Sentry, DataDog) to track:
- 5xx errors from Worker
- High latency (slow queries)
- Vector search relevance metrics
