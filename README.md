# FlowLens

**A local-first map and health check for your codebase — built for projects
written with AI.**

You prototyped something fast with Claude Code, Cursor, Lovable or Bolt. It
works, but you no longer know how the pieces fit together, which files
everything depends on, or where the tangles are. FlowLens indexes your repo,
draws it as an interactive map, flags circular dependencies and
architecture-rule violations, and gives your coding agent the same
structural knowledge through an MCP server — so it stops guessing.

- **Visual canvas** — system → module → file → symbol, with metrics overlays.
- **Health checks** — cycles, layer violations, complexity hot spots
  (`flowlens check`, CI-friendly exit codes).
- **MCP server** — 12 tools (`get_context`, `get_dependents`, `traverse`,
  `detect_cycles`, `check_architecture`, …) for Claude Code and other agents.
- **Exports** — JSON, Graphviz DOT, Mermaid.

> **Status:** pre-release (0.1). FlowLens is **not yet published to npm** —
> the `flowlens` name on npm is not ours. Install from source or a tarball
> (below).

## 60-second quickstart

Requires Node.js 20 or newer.

```bash
# 1. Build a tarball from source (once)
git clone https://github.com/sarupurisailalith/FlowLens.git
cd FlowLens && npm ci && npm pack          # → flowlens-0.1.0.tgz

# 2. Use it in any project
cd ~/code/my-app
npm i -D ~/path/to/FlowLens/flowlens-0.1.0.tgz   # or: npm i -g <tgz>
npx flowlens init        # index + infer architecture layers → .flowlens/
npx flowlens check       # cycles + architecture violations
npx flowlens canvas      # opens http://127.0.0.1:5173/
```

`flowlens canvas` serves the pre-built UI and the graph API from **one local
port**; no dev server or build step is needed in your project.

## Commands

| Command | What it does |
|---|---|
| `flowlens init [--ai --provider anthropic\|openai\|ollama]` | Create `.flowlens/`, index the repo, infer architecture layers (heuristic by default; optional AI uses graph topology only) |
| `flowlens index` | Incremental re-index after changes |
| `flowlens check [--cycles] [--architecture] [--format json]` | Validate architecture rules and detect cycles (non-zero exit for CI) |
| `flowlens canvas [--port 5173] [--no-open]` | Open the visual canvas (UI + API on one port, bound to 127.0.0.1) |
| `flowlens serve` | Start the MCP server on stdio for coding agents |
| `flowlens watch` | Re-index incrementally on file changes |
| `flowlens export --format json\|dot\|mermaid [--scope src/x/]` | Export the graph (Mermaid warns and suggests `--scope` for large graphs) |
| `flowlens doctor [--format json]` | Diagnose setup: graph, config, MCP server (started in-process), AI, environment |

## Connect Claude Code (MCP)

From your project root:

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

Install FlowLens in the project first (quickstart step 2) — until it is on
npm, a bare `npx flowlens` in a project without it would fetch an unrelated
package. Run `flowlens init` first so the graph exists. `flowlens doctor` verifies the
MCP server starts and lists its tools. (MCP config format per the
[Claude Code MCP docs](https://code.claude.com/docs/en/mcp).)

## Multiple projects (coming in this release)

FlowLens is moving to one explorer for all your repos: every `flowlens init`
registers the project in `~/.flowlens/projects.json`, a small local graph
service owns each project's database (so `serve`, `check`, hooks and the
canvas no longer fight over locks), and `flowlens canvas` opens a **Home**
tab with the health of every registered project plus one tab per project.
Missing or moved projects show a relink/remove prompt.

## Privacy: local-first

- Indexing, analysis, the canvas and the MCP server run entirely on your
  machine. **No network calls** during indexing or analysis; no telemetry.
- The canvas binds to `127.0.0.1` by default.
- The only optional network use is `flowlens init --ai`, which sends
  **graph topology only** (file paths, cluster sizes, edge counts — never
  source code) to the provider you choose; Ollama keeps even that local.
- Everything FlowLens writes lives in `.flowlens/` (add it to `.gitignore`).

## Development

```bash
npm ci
npm run lint        # tsc --noEmit for the CLI and the canvas
npm test            # vitest
npm run build       # tsc → dist/, vite build → dist/canvas/app
node dist/cli/index.js --help
```

- Canvas with hot reload (source checkout only):
  `node dist/cli/index.js canvas --dev` (Vite middleware on the same port).
- Languages: TypeScript/JavaScript are first-class; Python, Go, Rust, Java,
  C/C++ and others are parsed via `@ast-grep` grammars with lighter
  relation coverage.
- Architecture and contracts: `src/contracts/` is the source of truth for
  every component boundary. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Sailalith Sarupuri
