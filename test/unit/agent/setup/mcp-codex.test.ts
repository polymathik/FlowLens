import { describe, expect, it } from 'vitest';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BLOCK_END, BLOCK_START, applyBlock, removeBlock, renderBlock, scanCodexToml } from '../../../../src/agent/setup/codex-block.js';
import { installCodexMcp, uninstallCodexMcp } from '../../../../src/agent/setup/mcp-codex.js';
import { resolveServeCommand } from '../../../../src/agent/setup/serve-command.js';
import { tempDir } from './helpers.js';

const cmd = resolveServeCommand('/nowhere', { shared: false, command: 'node "/opt/fl/dist/cli/index.js"' });
const USER_TOML = '# my config\nmodel = "gpt-5"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp"]\n';

describe('codex managed block', () => {
  it('renders a self-contained table', () => {
    const block = renderBlock(cmd, '/work/proj');
    expect(block.startsWith(BLOCK_START)).toBe(true);
    expect(block.endsWith(BLOCK_END)).toBe(true);
    expect(block).toContain('[mcp_servers.flowlens]');
    expect(block).toContain('command = "node"');
    expect(block).toContain('args = ["/opt/fl/dist/cli/index.js", "serve"]');
    expect(block).toContain('cwd = "/work/proj"');
  });

  it('inserts after existing content without touching it, updates in place, removes cleanly', () => {
    const block = renderBlock(cmd);
    const added = applyBlock(USER_TOML, block);
    expect(added.changed).toBe(true);
    expect(added.text.startsWith(USER_TOML)).toBe(true);
    expect(applyBlock(added.text, block).changed).toBe(false);

    const newer = renderBlock({ ...cmd, args: ['/new/index.js', 'serve'] });
    const updated = applyBlock(added.text, newer);
    expect(updated.text.startsWith(USER_TOML)).toBe(true);
    expect(updated.text).toContain('/new/index.js');
    expect(updated.text).not.toContain('/opt/fl/dist');

    // text after the block is preserved too
    const withTail = `${added.text}\n[profiles.fast]\nmodel = "mini"\n`;
    const upd2 = applyBlock(withTail, newer);
    expect(upd2.text.endsWith('\n[profiles.fast]\nmodel = "mini"\n')).toBe(true);

    expect(removeBlock(added.text).text).toBe(USER_TOML);
    expect(removeBlock(USER_TOML).changed).toBe(false);
  });

  it('keeps CRLF files CRLF', () => {
    const crlf = 'a = 1\r\nb = 2\r\n';
    const out = applyBlock(crlf, renderBlock(cmd, undefined, '\r\n')).text;
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(out.startsWith(crlf)).toBe(true);
    expect(removeBlock(out).text).toBe(crlf);
  });

  it('refuses an unbalanced block', () => {
    expect(() => applyBlock(`${BLOCK_START}\nfoo\n`, renderBlock(cmd))).toThrow(/managed block/);
  });

  it('scans servers, disabled flags and foreign flowlens tables', () => {
    expect(scanCodexToml(USER_TOML).servers).toEqual([]);
    expect(scanCodexToml(applyBlock(USER_TOML, renderBlock(cmd)).text)).toMatchObject({ foreign_flowlens_table: false, servers: [{ name: 'flowlens', managed: true, disabled: false }] });
    expect(scanCodexToml('[mcp_servers.flowlens]\ncommand = "flowlens"\nenabled = false\n')).toMatchObject({ foreign_flowlens_table: true, servers: [{ disabled: true }] });
    expect(scanCodexToml('[mcp_servers.fl2]\ncommand = "npx"\nargs = ["--no-install", "flowlens", "serve"]\n').servers[0].name).toBe('fl2');
    expect(scanCodexToml('garbage ][ \u0000 = = =').servers).toEqual([]);
    expect(scanCodexToml('mcp_servers.flowlens.command = "x"\n').foreign_flowlens_table).toBe(true);
  });
});

describe('installCodexMcp / uninstallCodexMcp', () => {
  it('writes the project file (both scopes), is idempotent, never rewrites outside the block', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, '.codex'));
    const path = join(dir, '.codex/config.toml');
    await writeFile(path, USER_TOML);

    const first = await installCodexMcp({ projectDir: dir, scope: 'shared', command: 'node "/opt/fl/dist/cli/index.js"' });
    expect(first).toMatchObject({ method: 'codex-config', changed: true, path });
    expect(first.backup_path).toBeTruthy();
    const text = await readFile(path, 'utf-8');
    expect(text.startsWith(USER_TOML)).toBe(true);
    expect(text).not.toContain('cwd =');

    const second = await installCodexMcp({ projectDir: dir, scope: 'shared', command: 'node "/opt/fl/dist/cli/index.js"' });
    expect(second.changed).toBe(false);
    expect(await readFile(path, 'utf-8')).toBe(text);

    const removed = await uninstallCodexMcp(dir);
    expect(removed.removed).toEqual(['.codex/config.toml managed block']);
    expect(await readFile(path, 'utf-8')).toBe(USER_TOML);
  });

  it('local scope pins cwd, excludes a file it created from git, and deletes it on uninstall', async () => {
    const dir = await tempDir();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const r = await installCodexMcp({ projectDir: dir, scope: 'local', command: 'node "/opt/fl/dist/cli/index.js"' });
    expect(r.changed).toBe(true);
    expect(await readFile(join(dir, '.codex/config.toml'), 'utf-8')).toContain(`cwd = "${dir}"`);
    expect(await readFile(join(dir, '.git/info/exclude'), 'utf-8')).toContain('/.codex/config.toml');
    expect(r.warnings?.join(' ')).toMatch(/absolute path/);
    await uninstallCodexMcp(dir);
    expect(existsSync(join(dir, '.codex/config.toml'))).toBe(false);
  });

  it('does not touch a hand-written [mcp_servers.flowlens] and warns', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, '.codex'));
    const path = join(dir, '.codex/config.toml');
    const mine = '[mcp_servers.flowlens]\ncommand = "flowlens"\nargs = ["serve"]\n';
    await writeFile(path, mine);
    const r = await installCodexMcp({ projectDir: dir, scope: 'shared' });
    expect(r.changed).toBe(false);
    expect(r.warnings?.join(' ')).toContain('by hand');
    expect(await readFile(path, 'utf-8')).toBe(mine);
    expect((await readdir(join(dir, '.codex'))).length).toBe(1);
    const u = await uninstallCodexMcp(dir);
    expect(u.removed).toEqual([]);
    expect(u.warnings.join(' ')).toContain('did not write');
    expect(await readFile(path, 'utf-8')).toBe(mine);
  });
});
