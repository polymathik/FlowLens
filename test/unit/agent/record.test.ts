import { describe, it, expect } from 'vitest';
import { creditedFiles, flowlensToolName, responseText } from '../../../src/agent/record.js';
import { buildToolGuidance } from '../../../src/agent/guidance.js';
import { changedFilesFromHook, patchFiles } from '../../../src/agent/hook-input.js';

const entityBody = (file: string) => JSON.stringify({ data: { entity: { file, name: 'x' } } });

describe('flowlensToolName', () => {
  it('strips the MCP prefix and rejects other tools', () => {
    expect(flowlensToolName('mcp__flowlens__get_dependents')).toBe('get_dependents');
    expect(flowlensToolName('mcp__other__get_dependents')).toBeNull();
    expect(flowlensToolName(undefined)).toBeNull();
  });
});

describe('responseText', () => {
  it('reads strings, content blocks, wrapped content and data objects', () => {
    expect(responseText('plain')).toBe('plain');
    expect(responseText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(responseText({ content: [{ type: 'text', text: 'c' }] })).toBe('c');
    expect(responseText({ data: { entity: { file: 'f.ts' } } })).toContain('f.ts');
    expect(responseText(null)).toBe('');
    expect(responseText(42)).toBe('');
  });
});

describe('creditedFiles', () => {
  it('credits the entity file for get_context / get_dependents / traverse in any response shape', () => {
    const f = 'packages/core/src/session.ts';
    for (const tool of ['get_context', 'get_dependents', 'traverse']) {
      expect(creditedFiles(tool, entityBody(f))).toEqual([f]);
      expect(creditedFiles(tool, [{ type: 'text', text: entityBody(f) }])).toEqual([f]);
      expect(creditedFiles(tool, { content: [{ type: 'text', text: entityBody(f) }] })).toEqual([f]);
    }
    expect(creditedFiles('get_context', entityBody('a\\b.ts'))).toEqual(['a/b.ts']);
  });

  it('credits every distinct file of get_module_interface exports', () => {
    const body = JSON.stringify({ data: { exports: [{ entity: { file: 'a.ts' } }, { entity: { file: 'a.ts' } }, { entity: { file: 'b.ts' } }, {}] } });
    expect(creditedFiles('get_module_interface', body)).toEqual(['a.ts', 'b.ts']);
  });

  it('credits nothing for other tools, errors and garbage', () => {
    expect(creditedFiles('search_entities', entityBody('a.ts'))).toEqual([]);
    expect(creditedFiles('get_context', JSON.stringify({ error: { code: 'not_found' } }))).toEqual([]);
    expect(creditedFiles('get_context', 'not json')).toEqual([]);
    expect(creditedFiles('get_context', undefined)).toEqual([]);
  });
});

describe('patchFiles / apply_patch', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: src/a.ts',
    '@@',
    '-x',
    '+y',
    '*** Add File: src/new.ts',
    '+z',
    '*** Delete File: src/old.ts',
    '*** Update File: src/b.ts',
    '*** Move to: src/c.ts',
    '*** End Patch',
  ].join('\n');

  it('lists added, updated, deleted and moved files', () => {
    expect(patchFiles(patch)).toEqual(['src/a.ts', 'src/new.ts', 'src/old.ts', 'src/b.ts', 'src/c.ts']);
    expect(patchFiles(undefined)).toEqual([]);
  });

  it('is used by changedFilesFromHook for apply_patch', () => {
    const files = changedFilesFromHook({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: patch } }, '/repo');
    expect(files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/new.ts', 'src/old.ts']);
  });
});

describe('buildToolGuidance', () => {
  it('names the exact tools and the deferred-tool hint for Claude Code', () => {
    const text = buildToolGuidance({ tools: true, gate: true }).join('\n');
    expect(text).toContain('mcp__flowlens__get_dependents');
    expect(text).toContain('mcp__flowlens__get_context');
    expect(text).toContain('noisy');
    expect(text).toContain('held until');
    expect(text).toContain('select:mcp__flowlens__get_dependents');
  });

  it('omits the gate line without the gate, the ToolSearch hint for Codex, and everything without tools', () => {
    expect(buildToolGuidance({ tools: true, gate: false }).join('\n')).not.toContain('held until');
    expect(buildToolGuidance({ tools: true, gate: false, agent: 'codex' }).join('\n')).not.toContain('ToolSearch');
    expect(buildToolGuidance({ tools: false, gate: true })).toEqual([]);
  });
});
