/**
 * MCP resource `flowlens://health` — the Phase 11 plain-English health
 * report (grade, top risks, fix prompts) as Markdown, computed from the
 * server's own graph store (no second LevelDB open, works through the
 * daemon).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../contracts/mcp/server.js';
import { HEALTH_RESOURCE_URI } from '../contracts/health.js';
import { buildHealthReport, loadHealthInput, renderMarkdown } from '../health/index.js';

export { HEALTH_RESOURCE_URI };

export async function renderHealthResource(deps: Pick<ServerDependencies, 'graph' | 'rootDir'>): Promise<string> {
  try {
    const input = await loadHealthInput(deps.rootDir, { graphStore: deps.graph });
    return renderMarkdown(await buildHealthReport(input, { top: 10 }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `# FlowLens health\n\nThe health report could not be built: ${message}\n\nRun \`flowlens report\` in the project for details.\n`;
  }
}

export function registerHealthResource(server: McpServer, deps: ServerDependencies): void {
  server.registerResource(
    'flowlens-health',
    HEALTH_RESOURCE_URI,
    {
      title: 'FlowLens Health Report',
      description: 'Plain-English codebase health check-up: grade, top risks and suggested fixes (Markdown).',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await renderHealthResource(deps) }],
    }),
  );
}
