# FlowLens — Claude Code Instructions

## Code Architecture

- **Modular design is mandatory.** Extract reusable logic into shared utilities, helpers, and base classes. Never duplicate functionality — if something is used in more than one place, it must be abstracted.
- **File size limit: ~300 lines per file.** If a file approaches this limit, split it into focused modules with clear single responsibilities.
- **Prefer composition over inheritance.** Build features by composing small, well-defined modules rather than deep inheritance chains.

## Before Implementing

- **Always search for the latest documentation and best implementation patterns** before writing code. Use web search, official docs, and community best practices to ensure you're using current APIs and idiomatic approaches.
- **Check existing code first.** Before creating new utilities or helpers, search the codebase for existing implementations that can be reused or extended.

## Documentation

- **Living documentation is required.** The `_docs/` folder contains the project's living documentation. Every implementation or modification must be documented there as it happens — not after the fact.
- **Diagrams and charts must use Mermaid syntax.** When any documentation includes architecture diagrams, flow charts, sequence diagrams, dependency graphs, or any other visual representation, always use Mermaid markdown syntax. Never use ASCII art or external image files for diagrams.
- **Document what and why, not just how.** Include architectural decisions, trade-offs considered, and rationale alongside technical specifications.

## Project Structure

```
FlowLens/
├── _docs/                  # Living documentation (gitignored)
│   └── DESIGN_AND_SPEC.md  # Comprehensive design & spec document
├── .flowlens/              # Generated graph data (gitignored)
├── src/                    # Source code
├── .gitignore
└── CLAUDE.md               # This file
```

## Key Technical Decisions

- **Parser:** `@ast-grep/napi` (tree-sitter, Rust, Node.js bindings)
- **Graph storage:** LevelGraph (embedded, leveldown)
- **Protocol:** MCP (Model Context Protocol) for AI assistant integration
- **Runtime:** Node.js
- **Local-first:** Zero external API calls during indexing or analysis
