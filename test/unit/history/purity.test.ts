import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { join } from 'node:path';

const ENTRY = join(import.meta.dirname, '../../../src/analysis/history/index.ts');

describe('history analysis purity', () => {
  it('bundles for the browser from index.ts alone: no Node built-ins, no third-party packages, only analysis + contracts', async () => {
    const result = await build({
      entryPoints: [ENTRY], bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some((f) => f.includes('node_modules'))).toBe(false);
    expect(inputs.every((f) => /src\/(analysis\/history|contracts)\//.test(f))).toBe(true);
    expect(inputs.some((f) => /history-schema/.test(f))).toBe(false); // zod stays server-side
    expect(result.outputFiles[0].text).not.toMatch(/node:|require\("(fs|path|child_process)"\)/);
  });
});
