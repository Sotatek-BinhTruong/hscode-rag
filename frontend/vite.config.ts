import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    proxy: {
      '/query': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
})