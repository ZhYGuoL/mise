# Lane U: apply Zhiyuan's click-to-comment UI notes

Read `CLAUDE.md` first. Branch `lane/u-ui`. You may edit anything under `web/src/**` for visual
changes. Do not change behavior, data flow, API calls or `shared/contracts.ts`. Lane H is working in
`web/src/left/import/**` and lane D in the server at the same time; avoid those paths.

## How the notes arrive
Zhiyuan opens this worktree's dev server with `?review` (e.g. `http://localhost:<WEB_PORT>/?seed=1&review`),
clicks any element and types a note. Notes land in `.review/review-comments.json` at this worktree's
root. Each entry has `path` (CSS path under `<body>`), `target` (the element's text), `box`, `comment`,
`status`, `reply`. The overlay code is `web/review-plugin.ts` + `web/review/review.js`; leave them alone.

## Loop
1. Keep `bun run dev` running in this worktree so he sees changes live (Vite hot reload).
2. When he says "apply" (or when you notice new open comments), read every entry with `status` not
   `"done"`. Find the element by `target` text first (React class names and paths can shift), confirm
   with `path` and `box`.
3. Make the change in the React source. Follow the UI rules in `CLAUDE.md` and his taste: measure a
   "too small / too weak" complaint against the design system's own type scale before inventing a
   size; cut explainer text rather than add it; motion needs a cause.
4. Take a screenshot of the changed area and look at it.
5. Mark each handled comment `status: "done"` with `reply` = one line on what changed (and any
   caveat), by POSTing the full array to `http://localhost:<WEB_PORT>/__review/api/comments`.
   His open page refreshes its pins on its own.
6. Commit after each batch: `UI notes: <short summary>`.

If a note is ambiguous, make the best reading, apply it, and say in the reply what you assumed.
