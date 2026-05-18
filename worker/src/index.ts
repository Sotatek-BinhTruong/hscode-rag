/**
 * Hono app entry point for Cloudflare Workers.
 * Routes: POST /query, GET /health
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { queryRoute } from './routes/query-route.ts'

export type Bindings = {
  VECTORIZE: VectorizeIndex
  AI: Ai
}

const app = new Hono<{ Bindings: Bindings }>()

app.use(
  '*',
  cors({
    // Allow Vite dev server and any Cloudflare Pages deployment
    origin: (origin) => {
      if (!origin) return '*'
      if (origin.startsWith('http://localhost:')) return origin
      if (origin.endsWith('.pages.dev')) return origin
      return null
    },
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86400,
  })
)

app.route('/query', queryRoute)

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

app.onError((err, c) => {
  console.error('Worker error:', err.message)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
