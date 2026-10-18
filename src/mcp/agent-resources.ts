import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from './server.js';
import { buildAgentContext } from '../agent/context-builder.js';
import { buildAgentGuardReport } from '../agent/guard.js';
import { formatContextMarkdown, formatGuardMarkdown } from '../agent/format.js';
import { getFilteredGitChangedFiles } from '../agent/changed-files.js';
import { readFreshDigest } from '../agent/digest-cache.js';

export function registerAgentResources(server: McpServer, deps: ServerDependencies): void {
  server.registerResource(
    'flowlens-architecture',
    'flowlens://architecture',
    {
      title: 'FlowLens Architecture',
      description: 'Current architecture layer configuration for this repository.',
      mimeType: 'application/json',
    },
    async (uri) => textResource(uri.href, await readArchitecture(deps.flowlensDir), 'application/json'),
  );

  server.registerResource(
    'flowlens-hotspots',
    'flowlens://hotspots',
    {
      title: 'FlowLens Hotspots',
      description: 'Compact agent context focused on code hotspots.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const context = await buildAgentContext(deps.graph, {
        event: 'session_start',
        max_items: 10,
      }, await contextOptions(deps));
      return textResource(uri.href, formatContextMarkdown(context), 'text/markdown');
    },
  );

  server.registerResource(
    'flowlens-changed-context',
    'flowlens://changed-context',
    {
      title: 'FlowLens Changed Context',
      description: 'Context packet for files currently changed in git.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const changed = await getFilteredGitChangedFiles(deps.rootDir);
      const context = await buildAgentContext(deps.graph, {
        event: 'pre_commit',
        changed_files: changed,
        max_items: 10,
      }, await contextOptions(deps));
      return textResource(uri.href, formatContextMarkdown(context), 'text/markdown');
    },
  );
}

export function registerAgentPrompts(server: McpServer, deps: ServerDependencies): void {
  server.registerPrompt(
    'flowlens-plan-task',
    {
      title: 'Plan With FlowLens Context',
      description: 'Create a code-change plan using FlowLens graph context.',
      argsSchema: {
        task: z.string().describe('The user task or feature request to plan.'),
      },
    },
    async ({ task }) => {
      const context = await buildAgentContext(deps.graph, {
        event: 'prompt_submit',
        prompt: task,
        max_items: 8,
      }, await contextOptions(deps));
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Plan this change using the FlowLens codebase context below.',
              `Task: ${task}`,
              formatContextMarkdown(context),
              'Return a concise implementation plan, including files to inspect first and risks to watch.',
            ].join('\n\n'),
          },
        }],
      };
    },
  );

  server.registerPrompt(
    'flowlens-review-change',
    {
      title: 'Review Change With FlowLens Guard',
      description: 'Review changed files using graph impact, cycles, and architecture rules.',
      argsSchema: {
        changed_files: z.string().optional().describe('Comma-separated changed files. Defaults to git diff.'),
      },
    },
    async ({ changed_files }) => {
      const changed = changed_files
        ? changed_files.split(',').map((file) => file.trim()).filter(Boolean)
        : await getFilteredGitChangedFiles(deps.rootDir);
      const guard = await buildAgentGuardReport(deps.graph, {
        changed_files: changed,
        changed_source: changed_files ? 'argument' : 'git',
        max_items: 10,
      }, { flowlensDir: deps.flowlensDir });
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Review this change using FlowLens guard output.',
              formatGuardMarkdown(guard),
              'Prioritize architectural regressions, new cycles, risky public interfaces, and missing tests.',
            ].join('\n\n'),
          },
        }],
      };
    },
  );
}

/** Reuse the persisted agent digest when it matches the on-disk graph (avoids full scans). */
async function contextOptions(deps: ServerDependencies) {
  const digest = await readFreshDigest(deps.flowlensDir);
  return { flowlensDir: deps.flowlensDir, digest: digest ?? undefined };
}

async function readArchitecture(flowlensDir: string): Promise<string> {
  const path = join(flowlensDir, 'architecture.json');
  if (!existsSync(path)) return JSON.stringify({ layers: [], message: 'No architecture.json found' }, null, 2);
  return readFile(path, 'utf-8');
}

function textResource(uri: string, text: string, mimeType: string) {
  return {
    contents: [{ uri, mimeType, text }],
  };
}
