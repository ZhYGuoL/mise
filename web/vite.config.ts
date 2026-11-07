import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { reviewOverlay } from './review-plugin.js'

const root = path.resolve(import.meta.dirname, '..')

export default defineConfig(({ mode }) => {
  // Ports come from the repo-root .env, so each lane worktree can run its own pair.
  const env = loadEnv(mode, root, '')
  const api = `http://localhost:${env.PORT || 8787}`
  return {
    plugins: [react(), tailwindcss(), reviewOverlay(root)],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': api,
        '/generated': api,
      },
    },
  }
})
