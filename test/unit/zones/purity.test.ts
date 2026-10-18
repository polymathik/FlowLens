import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { join } from 'node:path';

const ENTRY = join(import.meta.dirname, '../../../src/analysis/zones/index.ts');

describe('zones service purity', () => {
  it('bundles for the browser from index.ts alone: no Node built-ins, no third-party packages', async () => {
    const result = await build({
      entryPoints: [ENTRY], bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some((f) => f.includes('node_modules'))).toBe(false);
    expect(inputs.some((f) => /overrides-store|overrides-schema/.test(f))).toBe(false);
    expect(inputs.every((f) => /src\/(analysis|contracts)\//.test(f))).toBe(true);
    expect(result.outputFiles[0].text).not.toMatch(/node:|require\("(fs|path)"\)/);
  });
});
