/**
 * Parser truth 2, item 6: interface method signatures and abstract methods are
 * `method` entities; interface `extends` becomes `extend` relations.
 */
import { describe, it, expect } from 'vitest';
import { parseSource } from '../../helpers/parse-relations.js';

const members = async (code: string) => {
  const p = await parseSource(code);
  return p.entities.filter((e) => e.kind === 'method').map((e) => `${e.qualified_name.slice('src/a.ts/'.length)}${e.annotations?.signature ? ' ' + e.annotations.signature : ''} ${e.visibility}`).sort();
};

describe('signature entities', () => {
  it('extracts method signatures and function-typed properties, not data, accessors or index signatures', async () => {
    expect(await members([
      'export interface Port {',
      '  scan(opts: string): Promise<void>;',
      '  optional?(): void;',
      '  run: (a: number) => void;',
      '  readonly name: string;',
      '  data: { x: number };',
      '  get label(): string;',
      '  set label(v: string);',
      '  [key: string]: unknown;',
      '  (): void;',
      '  new (): Port;',
      '}',
    ].join('\n'))).toEqual(['Port.optional interface public', 'Port.run interface public', 'Port.scan interface public']);
  });

  it('collapses overload signatures onto one entity and extracts no parameters', async () => {
    const p = await parseSource('interface P { f(a: string): void; f(a: number): void; }\n');
    expect(p.entities.filter((e) => e.name === 'f')).toHaveLength(1);
    expect(p.entities.some((e) => e.kind === 'parameter')).toBe(false);
  });

  it('extracts abstract methods with their visibility, next to implemented ones', async () => {
    expect(await members([
      'abstract class Base {',
      '  abstract run(job: string): void;',
      '  protected abstract step(): void;',
      '  abstract get v(): number;',
      '  abstract name: string;',
      '  go(): void { this.run("x"); }',
      '}',
    ].join('\n'))).toEqual(['Base.go public', 'Base.run abstract public', 'Base.step abstract protected']);
  });

  it('contains the members and links interface heritage', async () => {
    const p = await parseSource([
      'interface A { a(): void }',
      'interface B { b(): void }',
      'interface C extends A, B<string> { c(): void }',
    ].join('\n'));
    expect(p.lines(['contain', 'extend'])).toEqual([
      'contain A -> A.a', 'contain B -> B.b', 'contain C -> C.c', 'extend C -> A', 'extend C -> B',
    ]);
  });

  it('notes an extends clause as an annotation (external bases stay silent in pass 2)', async () => {
    const p = await parseSource('interface E extends EventEmitter, Other<string, number> { x(): void }\ninterface F { y(): void }\n');
    expect(p.entities.find((e) => e.name === 'E')?.annotations).toEqual({ extends: 'EventEmitter,Other<string, number>' });
    expect(p.entities.find((e) => e.name === 'F')?.annotations).toBeUndefined();
  });
});

describe('calls through signatures (same file)', () => {
  it('resolves interface-typed receivers and abstract methods to entities', async () => {
    const p = await parseSource([
      'interface Port { scan(): void; stop(): void }',
      'abstract class Base { abstract run(): void; go() { this.run(); } }',
      'function f(port: Port) { port.scan(); }',
      'class K { constructor(private readonly port: Port) {} m() { this.port.stop(); } }',
    ].join('\n'));
    expect(p.lines(['call'])).toEqual(['call Base.go -> Base.run', 'call K.m -> Port.stop @this.port', 'call f -> Port.scan @port']);
  });
});
