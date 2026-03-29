/**
 * Error tolerance tests for all 15 language extractors.
 *
 * Validates that every registered extractor handles valid code,
 * empty input, and broken/malformed input without throwing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { extractorRegistry } from '../../../../src/parser/extractor-registry.js';
import { registerAllExtractors } from '../../../../src/parser/extractors/register-all.js';
import { typescriptExtractor } from '../../../../src/parser/extractors/typescript-extractor.js';

beforeAll(() => {
  ensureLanguagesRegistered();
  extractorRegistry.register(typescriptExtractor);
  registerAllExtractors();
});

/**
 * Each entry maps the extractor language key to the parse() language
 * string accepted by @ast-grep/napi, plus a valid code sample.
 */
const LANGUAGES = [
  { name: 'typescript', parse: 'TypeScript', sample: 'const x: number = 1;' },
  { name: 'python', parse: 'python', sample: 'def hello(): pass' },
  { name: 'java', parse: 'java', sample: 'class Foo {}' },
  { name: 'kotlin', parse: 'kotlin', sample: 'fun main() {}' },
  { name: 'csharp', parse: 'csharp', sample: 'class Foo {}' },
  { name: 'php', parse: 'php', sample: '<?php class Foo {} ?>' },
  { name: 'go', parse: 'go', sample: 'package main\nfunc main() {}' },
  { name: 'rust', parse: 'rust', sample: 'fn main() {}' },
  { name: 'c', parse: 'c', sample: 'int main() { return 0; }' },
  { name: 'cpp', parse: 'cpp', sample: 'int main() { return 0; }' },
  { name: 'swift', parse: 'swift', sample: 'func hello() {}' },
  { name: 'scala', parse: 'scala', sample: 'object Main {}' },
  { name: 'ruby', parse: 'ruby', sample: 'def hello; end' },
  { name: 'bash', parse: 'bash', sample: 'echo hello' },
  { name: 'json', parse: 'json', sample: '{"key": "value"}' },
  { name: 'yaml', parse: 'yaml', sample: 'key: value' },
];

/** Intentionally broken code per language. */
const BROKEN_SAMPLES: Record<string, string> = {
  typescript: 'const x: = ;; class {',
  python: 'def (\ndef class:',
  java: 'class { public void }}}',
  kotlin: 'fun { class }}}',
  csharp: 'class { void }}}',
  php: '<?php class { }}}',
  go: 'func main( {{{ return }',
  rust: 'fn main( {{{ }}',
  c: 'int main( {{{ return; }',
  cpp: 'int main( {{{ return; }',
  swift: 'func { class }}}',
  scala: 'class { def }}}',
  ruby: 'def class end end end',
  bash: 'function (( {{{ }',
  json: '{"key": , "broken": }',
  yaml: '  - : :\n  invalid:: :\n',
};

describe('error tolerance — all 15 languages', () => {
  for (const lang of LANGUAGES) {
    describe(lang.name, () => {
      it('extractor is registered', () => {
        const extractor = extractorRegistry.get(lang.name);
        expect(extractor).toBeDefined();
      });

      it('extracts entities from valid code without crashing', () => {
        const extractor = extractorRegistry.get(lang.name)!;
        const root = parse(lang.parse as any, lang.sample).root();
        const entities = extractor.extractEntities(root, `test.${lang.name}`);
        expect(Array.isArray(entities)).toBe(true);
      });

      it('extracts relations from valid code without crashing', () => {
        const extractor = extractorRegistry.get(lang.name)!;
        const root = parse(lang.parse as any, lang.sample).root();
        const entities = extractor.extractEntities(root, `test.${lang.name}`);
        const relations = extractor.extractRelations(
          root, `test.${lang.name}`, entities, '',
        );
        expect(Array.isArray(relations)).toBe(true);
      });

      it('handles empty input', () => {
        const extractor = extractorRegistry.get(lang.name)!;
        const root = parse(lang.parse as any, '').root();
        const entities = extractor.extractEntities(root, `test.${lang.name}`);
        expect(Array.isArray(entities)).toBe(true);
        const relations = extractor.extractRelations(
          root, `test.${lang.name}`, entities, '',
        );
        expect(Array.isArray(relations)).toBe(true);
      });

      it('handles broken/malformed input without throwing', () => {
        const extractor = extractorRegistry.get(lang.name)!;
        const broken = BROKEN_SAMPLES[lang.name] ?? '';
        const root = parse(lang.parse as any, broken).root();
        const entities = extractor.extractEntities(root, `test.${lang.name}`);
        expect(Array.isArray(entities)).toBe(true);
        const relations = extractor.extractRelations(
          root, `test.${lang.name}`, entities, '',
        );
        expect(Array.isArray(relations)).toBe(true);
      });
    });
  }
});
