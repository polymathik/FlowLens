# FlowLens — VS Code extension (groundwork)

This directory contains the architectural groundwork for a VS Code
extension that embeds the FlowLens canvas as a WebView. Shipping as a
published extension is post-v1; this code exists so the protocol between
the canvas and the host editor is defined and testable.

## Status

- ✅ Extension manifest (`package.json`) with activation events
- ✅ Entry point with `flowlens.openCanvas` + `flowlens.runDoctor` commands
- ✅ WebView host that loads the canvas (dev server or local build)
- ✅ postMessage protocol for canvas ↔ host communication
- ⏳ Bundling, publishing, and packaging — deferred to v1.1

## Protocol

The canvas (running as a web app in the VS Code WebView iframe) posts
messages of the shape `{ type: "flowlens:<verb>", ...payload }`. The host
forwards them to the extension. Symmetric host→canvas messages use the
same prefix.

### Canvas → Host

| `type` | Payload | Host action |
|--------|---------|-------------|
| `flowlens:entity-click` | `{ file: string, line?: number, column?: number }` | Opens the file at the given position in VS Code's editor. |
| `flowlens:run-doctor` | _none_ | Runs `flowlens doctor` in a new integrated terminal. |
| `flowlens:refresh` | _none_ | Host may trigger a re-index (future). |

### Host → Canvas

| `type` | Payload | Canvas action |
|--------|---------|---------------|
| `flowlens:overlay-set` | `{ overlay: string }` | Apply the named overlay. |
| `flowlens:drill-into` | `{ nodeId: string }` | Drill down to the node. |

Canvas-side emission happens in `src/canvas/components/Canvas.tsx` on
entity-click events; it's a no-op outside a WebView (no `window.parent`).

## Installing locally

1. `cd vscode-extension && npm install`
2. Open this folder in VS Code
3. Press F5 → extension host launches with FlowLens loaded

Then in the extension host window, run `flowlens index` on any project
and open the command palette → **FlowLens: Open Dependency Canvas**.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `flowlens.canvasUrl` | `http://127.0.0.1:4280` | Where the FlowLens explorer runs (the daemon; `flowlens daemon status` shows the port if 4280 was busy). |
