import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMcpJson, removeFlowLensServer, writeFlowLensServer } from '../../../../src/agent/setup/mcp-json.js';
import { resolveServeCommand, splitCommandLine } from '../../../../src/agent/setup/serve-command.js';
import { McpConfigError } from '../../../../src/agent/setup/types.js';
import { tempDir } from './helpers.js';

const cmd = resolveServeCommand('/nowhere', { shared: false, command: 'node "/opt/my tools/flowlens/dist/cli/index.js"' });

describe('serve command', () => {
  it('splits quoted base commands and appends serve', () => {
    expect(cmd.command).toBe('node');
    expect(cmd.args).toEqual(['/opt/my tools/flowlens/dist/cli/index.js', 'serve']);
    expect(cmd.display).toBe('node "/opt/my tools/flowlens/dist/cli/index.js" serve');
    expect(splitCommandLine(`a "b c" 'd e' f\\ g`)).toEqual(['a', 'b c', 'd e', 'f\\', 'g']);
  });

  it('shared scope warns about an absolute path, and uses npx when FlowLens is a dependency', async () => {
    const abs = resolveServeCommand('/nowhere', { shared: true });
    expect(abs.machine_specific).toBe(abs.command === 'node');
    const dir = await tempDir();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ devDependencies: { flowlens: '^1' } }));
    await import('node:fs/promises').then((fs) => fs.mkdir(join(dir, 'node_modules/.bin'), { recursive: true }));
    await writeFile(join(dir, 'node_modules/.bin/flowlens'), '');
    const portable = resolveServeCommand(dir, { shared: true });
    expect(portable.display).toBe('npx --no-install flowlens serve');
    expect(portable.warnings).toEqual([]);
  });
});

describe('.mcp.json merge', () => {
  it('creates the file, preserves other servers and keys, is idempotent', async () => {
    const dir = await tempDir();
    const path = join(dir, '.mcp.json');
    await writeFile(path, JSON.stringify({ other: 1, mcpServers: { github: { type: 'http', url: 'https://x' } } }));

    const first = await writeFlowLensServer(path, cmd, false);
    expect(first).toMatchObject({ changed: true, created: false });
    expect(first.backup_path).toBeTruthy();
    const data = JSON.parse(await readFile(path, 'utf-8'));
    expect(data.other).toBe(1);
    expect(data.mcpServers.github).toEqual({ type: 'http', url: 'https://x' });
    expect(data.mcpServers.flowlens).toEqual({ type: 'stdio', command: 'node', args: cmd.args });

    const before = await readFile(path, 'utf-8');
    const backups = (await readdir(dir)).filter((f) => f.includes('backup')).length;
    const second = await writeFlowLensServer(path, cmd, false);
    expect(second.changed).toBe(false);
    expect(await readFile(path, 'utf-8')).toBe(before);
    expect((await readdir(dir)).filter((f) => f.includes('backup')).length).toBe(backups);
  });

  it('creates a new file without a backup', async () => {
    const dir = await tempDir();
    const r = await writeFlowLensServer(join(dir, '.mcp.json'), cmd, false);
    expect(r).toMatchObject({ changed: true, created: true });
    expect(r.backup_path).toBeUndefined();
  });

  it('refreshes our entry (keeping user env) but not a foreign server named flowlens', async () => {
    const dir = await tempDir();
    const path = join(dir, '.mcp.json');
    await writeFile(path, JSON.stringify({ mcpServers: { flowlens: { command: 'node', args: ['/old/flowlens/cli.js', 'serve'], env: { A: '1' } } } }));
    expect((await writeFlowLensServer(path, cmd, false)).changed).toBe(true);
    expect(JSON.parse(await readFile(path, 'utf-8')).mcpServers.flowlens.env).toEqual({ A: '1' });

    const other = join(dir, 'other.json');
    await writeFile(other, JSON.stringify({ mcpServers: { flowlens: { command: 'python', args: ['my_server.py'] } } }));
    const r = await writeFlowLensServer(other, cmd, false);
    expect(r).toMatchObject({ changed: false, foreign: true });
    expect(JSON.parse(await readFile(other, 'utf-8')).mcpServers.flowlens.command).toBe('python');
    expect((await writeFlowLensServer(other, cmd, true)).changed).toBe(true);
  });

  it('never overwrites invalid JSON or an unexpected shape', async () => {
    const dir = await tempDir();
    const path = join(dir, '.mcp.json');
    await writeFile(path, '{ broken');
    await expect(writeFlowLensServer(path, cmd, false)).rejects.toMatchObject({ code: 'invalid_json' });
    expect(await readFile(path, 'utf-8')).toBe('{ broken');
    await writeFile(path, '[]');
    await expect(loadMcpJson(path)).rejects.toBeInstanceOf(McpConfigError);
    await writeFile(path, JSON.stringify({ mcpServers: [] }));
    await expect(writeFlowLensServer(path, cmd, false)).rejects.toMatchObject({ code: 'invalid_shape' });
    expect(await readFile(path, 'utf-8')).toBe(JSON.stringify({ mcpServers: [] }));
  });

  it('removes only our entry; deletes the file when it held nothing else', async () => {
    const dir = await tempDir();
    const path = join(dir, '.mcp.json');
    await writeFile(path, JSON.stringify({ mcpServers: { flowlens: { command: 'node', args: ['/x/flowlens/cli.js', 'serve'] }, github: { url: 'u' } } }));
    expect(await removeFlowLensServer(path)).toMatchObject({ removed: true, file_deleted: false });
    expect(JSON.parse(await readFile(path, 'utf-8'))).toEqual({ mcpServers: { github: { url: 'u' } } });
    await writeFile(path, JSON.stringify({ mcpServers: { flowlens: { command: 'node', args: ['/x/flowlens/cli.js', 'serve'] } } }));
    expect(await removeFlowLensServer(path)).toMatchObject({ removed: true, file_deleted: true });
    expect(existsSync(path)).toBe(false);
    await writeFile(path, JSON.stringify({ mcpServers: { flowlens: { command: 'python' } } }));
    expect((await removeFlowLensServer(path)).removed).toBe(false);
  });
});
