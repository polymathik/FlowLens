/**
 * FlowLens VS Code extension entry.
 *
 * Ships as a thin host that opens a WebView embedding the FlowLens canvas
 * and listens for `flowlens:*` postMessage events from the canvas to drive
 * host-side actions (open file at line, run doctor, etc.).
 *
 * STATUS: Phase 6 groundwork. Canvas embedding + message protocol are
 * wired; a full extension (bundled, published) is post-v1.
 *
 * Message protocol (see README.md §Protocol):
 *   canvas → host:  { type: 'flowlens:entity-click', file, line, column }
 *   host → canvas:  { type: 'flowlens:overlay-set', overlay }
 */
import * as vscode from 'vscode';

const CANVAS_URL_KEY = 'flowlens.canvasUrl';
const DEFAULT_CANVAS_URL = 'http://127.0.0.1:4280';

interface CanvasEntityClickMessage {
  type: 'flowlens:entity-click';
  file: string;
  line?: number;
  column?: number;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('flowlens.openCanvas', () => {
      openCanvasPanel(context);
    }),
    vscode.commands.registerCommand('flowlens.runDoctor', async () => {
      const terminal = vscode.window.createTerminal('FlowLens Doctor');
      terminal.sendText('flowlens doctor');
      terminal.show();
    }),
  );
}

export function deactivate(): void {
  /* no-op — WebView is cleaned up with its parent panel */
}

function openCanvasPanel(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'flowlensCanvas',
    'FlowLens Canvas',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const canvasUrl = vscode.workspace.getConfiguration().get<string>(
    CANVAS_URL_KEY,
    DEFAULT_CANVAS_URL,
  );

  panel.webview.html = webviewHtml(canvasUrl);

  panel.webview.onDidReceiveMessage((msg: CanvasEntityClickMessage) => {
    if (msg?.type === 'flowlens:entity-click' && msg.file) {
      openEditorAt(msg.file, msg.line, msg.column);
    }
  }, undefined, context.subscriptions);
}

async function openEditorAt(
  file: string,
  line?: number,
  column?: number,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;
  const uri = vscode.Uri.joinPath(folders[0].uri, file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const pos = new vscode.Position(
    Math.max(0, (line ?? 1) - 1),
    Math.max(0, (column ?? 1) - 1),
  );
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(pos, pos),
  });
}

function webviewHtml(canvasUrl: string): string {
  return /* html */ `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <iframe src="${canvasUrl}" title="FlowLens Canvas"></iframe>
    <script>
      // Forward messages from the canvas iframe up to the VS Code host.
      window.addEventListener('message', (event) => {
        const data = event.data;
        if (data && typeof data === 'object' && typeof data.type === 'string' && data.type.startsWith('flowlens:')) {
          const vscode = acquireVsCodeApi();
          vscode.postMessage(data);
        }
      });
    </script>
  </body>
</html>`;
}
