# Contributing to FlowLens

Thanks for helping! A few rules keep parallel work safe.

## Ground rules

1. **Contracts first.** Every cross-component boundary is a type in
   `src/contracts/`. Change the contract (prefer additive, optional fields),
   check its consumers, then implement. If code and contract disagree, the
   contract wins.
2. **Small modules.** Keep files under ~300 lines; extract shared helpers
   instead of duplicating logic.
3. **Local-first.** No network calls during indexing or analysis.
4. **Tests with every change.** Add focused unit tests plus at least one
   end-to-end test that exercises real behaviour (index a fixture → assert
   on graph/tool/CLI output). Never weaken a test to make it pass unless it
   asserted a documented bug — say so in the commit.

## Branches, lanes and worktrees

- Each phase lives on its own branch `phase-N-<name>`.
- When work runs in parallel **lanes**, each lane gets its own branch **and
  its own git worktree** (`git worktree add ../FlowLens-<lane> <branch>`).
  A lane edits only the files it owns; needed changes elsewhere are
  requested, not made. The only shared edit allowed is registering a command
  in `src/cli/index.ts`.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`), small and
  focused.

## Before you push

```bash
npm run lint && npm test && npm run build
npm pack --dry-run      # only dist/, README, LICENSE, NOTICE, package.json
```

There is no hosted CI. Before a release, also run the clean-install smoke
test, which packs the tarball, installs it into a fresh temp project and
exercises init, index, check, export, doctor, report and the explorer:

```bash
npm run smoke:pack
npm run test:canvas:e2e   # browser E2E (needs Playwright's Chromium)
```

## Docs and diagrams

Document decisions (what and why) alongside the change. Diagrams use
Mermaid.

## License of contributions

FlowLens is licensed under the [Apache License 2.0](LICENSE). By submitting
a contribution you agree that it is licensed under Apache-2.0 as well
(Section 5 of the license), with no additional terms.
