/**
 * Dev-only click-to-comment overlay (Zhiyuan's click-review workflow).
 * Open the app with `?review` in the URL, click any element, type a note, Enter saves.
 * Comments land in <repo>/.review/review-comments.json (gitignored), one file per worktree.
 * An agent applies them, marks each `status: "done"` with a one-line `reply`, and Vite HMR
 * shows the change live. Never active in production builds.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

export function reviewOverlay(repoRoot: string): Plugin {
  const dir = path.join(repoRoot, '.review')
  const file = path.join(dir, 'review-comments.json')
  const script = path.join(import.meta.dirname, 'review', 'review.js')
  const read = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]')

  return {
    name: 'mise-review-overlay',
    apply: 'serve',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          injectTo: 'body',
          children:
            "if (new URLSearchParams(location.search).has('review')) {" +
            "window.__REVIEW_FILE__='app';" +
            "var s=document.createElement('script');s.src='/__review/review.js';document.body.appendChild(s);}",
        },
      ]
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (url === '/__review/review.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          return res.end(fs.readFileSync(script))
        }
        if (url === '/__review/api/comments' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          return res.end(read())
        }
        if (url === '/__review/api/comments' && req.method === 'POST') {
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', () => {
            fs.mkdirSync(dir, { recursive: true })
            const data = JSON.parse(body || '[]')
            fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
            fs.renameSync(file + '.tmp', file)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, count: data.length }))
          })
          return
        }
        if (url === '/__review/api/version') {
          // content is constant: Vite HMR already reloads code changes, the overlay only needs comment changes.
          const cm = fs.existsSync(file) ? fs.statSync(file).mtimeMs / 1000 : 0
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ content: 'vite', comments: cm }))
        }
        next()
      })
    },
  }
}
