# Beautiful UI (beautifului.dev)

Copy-paste components for agent interfaces by Turbo. Distributed as a shadcn registry.
Install commands verified from the site on 2026-11-07. Install `foundation` first (tokens).

```bash
cd web
npx shadcn add https://www.beautifului.dev/r/foundation.json
```

| Component | Command suffix (`npx shadcn add https://www.beautifului.dev/r/<slug>.json`) | Used for |
|---|---|---|
| Chat (tabbed panel + composer) | `chat-composer` | Lane A: the ideation conversation |
| Prompt Bar | `prompt-bar` | Lane A: input with `@` and `/` |
| Thinking | `thinking-state` | Lane A: "reading the request", "running the city" traces |
| Streaming Text | `streaming-text` | Lane A: streamed agent replies |
| Tool Chips | `tool-chips` | Lane A: edits and tool calls as chips with +/- counts |
| Diff Table | `diff-table` | Lane A: Cursor-style concept diffs (old -> new) |
| Approval Card | `approval-card` | Lane A: "apply these 2 edits?" |
| Task Rows | `task-rows` | Lane B: image generation queue |
| Loading State | `loading-state` | Lane E: while a simulation runs |
| Insight Cards | `insight-cards` | Lane E: prediction headlines with charts |
| Recommendation Card | `recommendation-card` | Lane E / Wave 2: "drop combo to $11" suggestions |
| Fine-tune Card | `fine-tune-card` | Lane B: adjust a dish or the menu card |
| Context Cards | `context-cards` | Wave 2: resident interview evidence |

Other slugs that exist: `records-table`, `filter-table`, `sidebar-nav`, `search`, `flowchart`,
`code-block`, `selection-actions`, `agent-screen`.

The site's demo world is an ice cream creamery. Replace all demo copy with Mise content.
