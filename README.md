# FlowLens

**A local-first map and health check for your codebase, built for projects
written with AI.**

You prototyped something fast with Claude Code, Cursor, Lovable or Bolt. It
works, but you no longer know how the pieces fit together, which files
everything depends on, or where the tangles are. FlowLens indexes your repo,
gives it a plain-English health grade with ready-to-paste fix prompts, draws
it as an interactive map, and gives your coding agent the same structural
knowledge through an MCP server and Claude Code hooks, so it stops guessing.

- **Health check-up**: a grade, a score breakdown and the top risks
  (tangles, hard-to-follow code, fragile hubs, oversized files, rule breaks),
  each with a fix prompt for your AI assistant (`flowlens report`, or the
  Health screen in the explorer).
- **Explorer**: one browser app for all your projects. Home shows every
  project's health; each project has a Health screen and an interactive Map
  (system → module → file → symbol, with overlays).
- **For coding agents**: an MCP server with 12 tools, health and context
  resources, and optional Claude Code hooks that add context to prompts and
  check every edit.
- **CI-friendly checks**: `flowlens check` exits non-zero on dependency
  cycles or architecture-rule violations. Exports to JSON, Graphviz DOT and
  Mermaid.

> **Status:** pre-release (0.1). FlowLens is **not published to npm yet**.
> It will be published as `flowlens`. Until then, install it from a tarball
> built from source (below).

## Quickstart

Requires Node.js 20 or newer.

```bash
# 1. Build a tarball from source (once)
git clone https://github.com/sarupurisailalith/FlowLens.git
cd FlowLens && npm ci && npm run build && npm pack    # → flowlens-0.1.0.tgz

# 2. Use it in any project
cd your-project
npm i -D /path/to/FlowLens/flowlens-0.1.0.tgz         # or: npm i -g <tgz>
npx flowlens init      # index the code, infer architecture layers → .flowlens/
npx flowlens canvas    # open the explorer in your browser
npx flowlens report    # the same health check-up as Markdown in the terminal
```

`flowlens canvas` signs your browser in to the local FlowLens daemon and
opens the explorer at **http://127.0.0.1:4280** (or another free port, see
[The daemon](#the-daemon)). Nothing is built or served from your project.

## The explorer

| Screen | What you see |
|---|---|
| **Home** | A card per registered project with its grade and top risk, worst first. Missing or moved projects explain themselves and can be removed. |
| **Health** (per project) | Grade and score breakdown, then findings ranked by urgency. Each finding says why it matters in plain English, lists the exact files and lines, has **Copy fix prompt**, and **Show on map**. |
| **Map** (per project) | The dependency map: double-click to drill from system to module to file to symbol. Overlays: code quality, recent changes, hotspots, dependency cycles, rule breaks, interface diff. Search (⌘K), rules editor, PNG/SVG export, light and dark themes. |

Links from MCP tools and `flowlens report` ("Show on map") open the right
project and view, e.g. `http://127.0.0.1:4280/#/p/<project-id>/map/file/src%2Fapp.ts?overlay=cycles`.
The explorer only works in a browser signed in through `flowlens canvas`; if
you open a link without a session, the page tells you to run
`flowlens canvas` (sign-in links work once, for 60 seconds, and sessions end
when the daemon restarts).

Add `--watch` to keep the project re-indexing while the command runs; open
tabs update live.

## Health report

```bash
npx flowlens report                         # Markdown, top 10 findings
npx flowlens report --format html --out health.html
npx flowlens report --format json           # the HealthReport contract
```

Findings are written for people who did not hand-write their code. Loops
made only of `import type` lines or type annotations are listed as
information (they disappear at runtime), and lockfiles, generated or
minified files and data files (JSON, YAML) are never flagged for size.

## Connect Claude Code

**MCP server.** From your project root:

```bash
claude mcp add --transport stdio --scope project flowlens -- npx flowlens serve
```

or commit an `.mcp.json`:

```json
{
  "mcpServers": {
    "flowlens": {
      "type": "stdio",
      "command": "npx",
      "args": ["flowlens", "serve"]
    }
  }
}
```

Install FlowLens in the project first (quickstart step 2): until it is on
npm, `npx flowlens` in a project without it cannot find it. `flowlens serve`
indexes the project on first use if needed. Tools: `get_context`,
`get_dependents`, `get_module_interface`, `annotate`, `traverse`,
`detect_cycles`, `get_metrics`, `diff_interface`, `check_architecture`,
`get_summary`, `get_hotspots`, `get_layer_map`. Resources:
`flowlens://health`, `flowlens://architecture`, `flowlens://hotspots`,
`flowlens://changed-context`; prompts `flowlens-plan-task` and
`flowlens-review-change`. `flowlens doctor` checks that the server starts.
(Config format per the [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).)

**Hooks (optional).**

```bash
npx flowlens agent install claude-code            # writes .claude/settings.local.json (personal)
npx flowlens agent install claude-code --shared   # writes .claude/settings.json (team)
npx flowlens agent uninstall claude-code          # removes only FlowLens's entries, from both files
```

This adds three project hooks: `SessionStart` and `UserPromptSubmit` inject
a compact map of the code relevant to the prompt (plus a one-line health
headline); `PostToolUse` re-indexes edited files and reports new cycles or
rule breaks (`--strict`: new ones block). Any settings file FlowLens changes
is backed up first (`*.flowlens-backup-*`).

`flowlens agent install claude-code` writes your personal
`.claude/settings.local.json` (Claude Code applies it over
`.claude/settings.json`; FlowLens adds it to `.git/info/exclude`), because the
default hook command contains the absolute path of your FlowLens install —
don't commit it. To share hooks with your team, add FlowLens as a
devDependency (`npm install -D flowlens`) and run
`flowlens agent install claude-code --shared`: the committed
`.claude/settings.json` then uses `npx --no-install flowlens …`, which works on
every machine. Re-running install refreshes the hooks after you move FlowLens;
`flowlens agent uninstall claude-code` removes them from both files.

## The daemon

One small local service (the FlowLens daemon) owns every project's graph
database, so `serve`, `watch`, `check`, `index`, hooks and the explorer can
all run at the same time without lock errors. Any command that needs it
starts it automatically; it exits after an hour without use.

- Listens on `127.0.0.1` only, port **4280** by default (set
  `FLOWLENS_DAEMON_PORT` to choose another; if the port is busy it picks a
  free one). Every request needs a random token or a browser session.
- `flowlens daemon status` lists running daemons (one per installed FlowLens
  version, so different versions never stop each other) and which project
  graphs are open; `flowlens daemon stop` stops this version's daemon
  (`--all` also stops idle daemons from other versions); `flowlens daemon
  start` starts it in the background.
- `--no-daemon` (or `FLOWLENS_NO_DAEMON=1`) makes a command open the
  database directly, for CI or scripts. Only one such process can use a
  project at a time.
- `FLOWLENS_HOME` (default `~/.flowlens`) holds the project registry and the
  daemon's files.

## Commands

Every command accepts `-h, --help`. Most accept `--no-daemon`.

| Command | What it does | Options |
|---|---|---|
| `flowlens init` | Create `.flowlens/`, index the repo, infer architecture layers, register the project | `--force` (start over), `--ai`, `--provider anthropic\|openai\|ollama`, `--model <m>`, `--no-daemon` |
| `flowlens index` | Incremental re-index after changes | `--no-daemon` |
| `flowlens report` | Plain-English health check-up with fix prompts | `--format md\|html\|json`, `--out <file>`, `--top <n>` (10), `--churn-days <n>` (90), `--no-git`, `--no-daemon` |
| `flowlens canvas` | Open the explorer (all registered projects) in the browser | `--no-open` (print the sign-in link), `--watch`, `--debounce <ms>` (300), `--dev` and `--port <port>` (contributors only: Vite UI on `--port`, default 5173) |
| `flowlens check` | Cycle detection and architecture validation; exit 0 clean, 1 issues, 2 error | `--format text\|json`, `--cycles`, `--architecture`, `--severity low\|medium\|high`, `--scope <path>`, `--include-type-only`, `--no-daemon` |
| `flowlens serve` | MCP server on stdio for coding agents | `--watch`, `--transport stdio`, `--no-daemon` |
| `flowlens watch` | Re-index on file changes | `--debounce <ms>` (300), `--no-daemon` |
| `flowlens export` | Export the graph | `--format json\|dot\|mermaid`, `--scope <path>`, `--relations <types>`, `--no-metrics`, `--output <file>`, `--no-daemon` |
| `flowlens snapshot` | Store a graph snapshot for the current git HEAD (used by interface diffs) | `--force`, `--list`, `--keep <n>` (20), `--no-daemon` |
| `flowlens doctor` | Diagnose setup: graph, config, MCP server, AI, environment | `--format text\|json` |
| `flowlens daemon start\|stop\|status` | Manage the local graph service | `start --foreground`, `status --json` |
| `flowlens projects list\|remove\|rename` | Manage registered projects (`remove` keeps `.flowlens/`) | `list --json`; `remove <project>`; `rename <project> <name>` |
| `flowlens agent context` | Compact code context for coding agents (used by hooks) | `--prompt`, `--changed <files>`, `--git`, `--event`, `--max-items`, `--budget`, `--format markdown\|json`, `--root`, `--hook`, `--no-daemon` |
| `flowlens agent guard` | Graph risk for changed files (used by hooks) | `--changed <files>`, `--git`, `--reindex`, `--strict`, `--min-risk none\|low\|medium\|high`, `--max-items`, `--budget`, `--format`, `--root`, `--hook`, `--no-daemon` |
| `flowlens agent baseline` | Show or reset the strict-mode baseline of pre-existing issues | `--reset`, `--format`, `--root`, `--no-daemon` |
| `flowlens agent install\|uninstall claude-code` | Add or remove Claude Code hooks in `.claude/settings.json` | install: `--command <cmd>`, `--force`, `--format`, `--root` |

## Language support

What the golden tests verify (TypeScript/JavaScript, Python, Java and Go
are fully linked across files; other languages are indexed at file level
with same-file links only):

| Language | Entities | Cross-file relations | Same-file only | Complexity |
|---|---|---|---|---|
| TypeScript / TSX | file, class, interface, function, method, field, variable, parameter, type, enum, namespace, decorator | import (relative, `.js`→`.ts`, tsconfig paths, workspaces, barrels, `import type`), extend, implement, override, call, create, throw, return | contain, decorate, mixin | yes |
| JavaScript (ESM + CommonJS) | as TS minus types | import (ESM, `require`), extend, override, call, create | contain, use | yes |
| Python | file, class, function, method, field, variable, decorator | import (absolute, relative, `__init__` re-exports), extend, override, call, create | contain, decorate | yes |
| Java | file, class, interface, enum, method, field, annotation | import, extend, implement, override, call, create, throw, return, parameter | contain, decorate, use | yes |
| Go | file, struct, interface, function, method, field, variable | import (go.mod paths), call, create | contain | yes |
| Kotlin, C#, PHP, Rust, C, C++, Swift, Scala, Ruby, Bash | entities | none (imports recorded as unresolved) | names in the same file | cyclomatic where measured |
| JSON, YAML, CSS, HTML | file | none | none | none |

## Privacy: local-first

- Indexing, analysis, the explorer, the daemon and the MCP server run
  entirely on your machine. **No network calls** during indexing or
  analysis, and no telemetry.
- The daemon binds `127.0.0.1` only and requires a token (CLI) or a
  sign-in cookie (browser).
- The only optional network use is `flowlens init --ai`, which sends
  **graph topology only** (file paths, cluster sizes, edge counts, never
  source code) to the provider you choose; Ollama keeps even that local.
- What FlowLens writes:
  - `.flowlens/` in each project: the graph, manifest, snapshots,
    architecture rules, caches. Add it to `.gitignore`.
  - `~/.flowlens/` (or `$FLOWLENS_HOME`): `projects.json` (the registry of
    project paths), `daemon-p<key>.json` per FlowLens version (port, pid
    and token, mode 0600), its log, and short-lived 0600 browser sign-in
    files under `run/`.
  - Only if you install hooks: `.claude/settings.local.json` (or
    `.claude/settings.json` with `--shared`), plus a
    `*.flowlens-backup-*` copy of the previous file, and an entry in
    `.git/info/exclude`.

## Troubleshooting

| Problem | Fix |
|---|---|
| "No FlowLens map found for this folder" | Run `npx flowlens init` in the project root first. |
| The explorer says you need to sign in | Run `npx flowlens canvas` again; links work once, for 60 seconds, and sessions end when the daemon restarts. |
| The explorer is not on port 4280 | Port 4280 was busy, so the daemon picked a free port. `flowlens daemon status` shows it; `flowlens canvas` always prints the right link. |
| "busy" / graph locked | A `--no-daemon` process holds the project's database. Stop it, or run without `--no-daemon`. |
| Results look stale after big changes | `npx flowlens index` (or keep `flowlens canvas --watch` / `serve --watch` running). |
| The daemon misbehaves after an upgrade | `npx flowlens daemon stop`; the next command starts the new version. |
| Anything else | `npx flowlens doctor` checks the graph, config, MCP server and environment. |

## Development

```bash
npm ci
npm run lint            # tsc --noEmit for the CLI and the canvas
npm test                # vitest
npm run build           # tsc → dist/, vite build → dist/canvas/app
npm run test:canvas:e2e # Playwright scenarios against the built explorer
npm run smoke:pack      # npm pack + clean install + CLI/explorer smoke
node dist/cli/index.js --help
```

- Explorer with hot reload (source checkout only):
  `node dist/cli/index.js canvas --dev` (Vite on `--port`, default 5173,
  proxying the API to the daemon).
- `src/contracts/` is the source of truth for every component boundary.
  See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). Copyright 2026 Sailalith Sarupuri; see
[NOTICE](NOTICE).
