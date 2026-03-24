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

## Contract-Driven Development

- **Define API contracts before implementation.** Every component integration must start with a typed contract (TypeScript interfaces, type aliases, or Zod schemas) that defines the shape of inputs, outputs, errors, and events. No implementation code is written until the contract is reviewed and validated.
- **Contracts live in dedicated files.** Place all contracts in `src/contracts/` (e.g., `src/contracts/parser.ts`, `src/contracts/graph.ts`, `src/contracts/mcp.ts`). Components import contracts from this central location — never define inline interface types that serve as cross-component boundaries.
- **Validate contracts before modifying components.** When changing any component, first check whether the change requires a contract update. If it does, update the contract first, verify all consumers still satisfy it, then implement the change. Never let implementation drift ahead of the contract.
- **Contracts are the source of truth.** If there is a discrepancy between a contract and an implementation, the contract wins. Fix the implementation, not the contract (unless the contract itself is being intentionally revised through the proper update flow).
- **Contract changes require impact analysis.** Before modifying any contract, identify all components that depend on it and assess the impact. Document breaking changes in `_docs/` alongside the modification.

## Development Lifecycle

- **Use subagents (superpowers) for the development lifecycle.** Leverage parallel agent execution for: researching best practices before implementation, validating contracts across components, running tests after changes, performing code reviews, and verifying documentation is up to date. When multiple independent tasks exist (e.g., "research API patterns" + "validate existing contracts" + "check test coverage"), spawn them in parallel rather than sequentially.
- **Research before building.** Before implementing any new component or integration, spawn a research agent to find the latest docs, patterns, and known issues for the relevant libraries.
- **Validate before committing.** After any implementation, spawn validation agents to: run the test suite, verify contract compliance, check that `_docs/` is updated, and confirm no regressions in dependent components.

## Git rules 
- Each phase will be implemented on respective branch. Create and switch to branch if it isn't present. For each phase, the corresponsing ground truth/reference is in _docs/specs/PHASE-* 
- Merge the brach to main only after phase implementation is done, validated against the specs in specs folder and the user manually tests it.

## Key Technical Decisions

- **Parser:** `@ast-grep/napi` (tree-sitter, Rust, Node.js bindings)
- **Graph storage:** LevelGraph (embedded, leveldown)
- **Canvas:** React Flow v12 (`@xyflow/react`) + ELK.js for layout
- **Protocol:** MCP (Model Context Protocol) for AI assistant integration
- **Runtime:** Node.js
- **Local-first:** Zero external API calls during indexing or analysis
