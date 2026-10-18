import { describe, it, expect } from 'vitest';
import { isSizeJudged } from '../../../src/health/file-kinds.js';
import { buildHealthContext } from '../../../src/health/context.js';
import { sizeRule } from '../../../src/health/rules/size.js';
import { GraphBuilder } from './graph-builder.js';

describe('isSizeJudged', () => {
  it('skips lockfiles, generated output and data files', () => {
    expect(isSizeJudged('package-lock.json', 'json')).toBe(false);
    expect(isSizeJudged('pnpm-lock.yaml', 'yaml')).toBe(false);
    expect(isSizeJudged('yarn.lock', undefined)).toBe(false);
    expect(isSizeJudged('web/vendor.min.js', 'javascript')).toBe(false);
    expect(isSizeJudged('dist/cli/index.js', 'javascript')).toBe(false);
    expect(isSizeJudged('packages/app/build/main.js', 'javascript')).toBe(false);
    expect(isSizeJudged('src/data/countries.json', 'json')).toBe(false);
    expect(isSizeJudged('config/deploy.yaml', 'yaml')).toBe(false);
  });

  it('judges hand-written code', () => {
    expect(isSizeJudged('src/server.ts', 'typescript')).toBe(true);
    expect(isSizeJudged('app/models/user.rb', 'ruby')).toBe(true);
    expect(isSizeJudged('src/builder.ts', 'typescript')).toBe(true);
  });
});

describe('size rule ignores non-code files', () => {
  it('flags a long .ts file but not a long lockfile or bundle', () => {
    const g = new GraphBuilder()
      .file('src/big.ts', { lines: 900 })
      .file('package-lock.json', { lines: 6000, language: 'json' })
      .file('dist/bundle.js', { lines: 5000, language: 'javascript' })
      .file('public/app.min.js', { lines: 3000, language: 'javascript' });
    const findings = sizeRule.run(buildHealthContext(g.input())) as Array<{ focus: { files: string[] } }>;
    expect(findings.map((f) => f.focus.files[0])).toEqual(['src/big.ts']);
  });
});
