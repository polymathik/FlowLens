/**
 * Parser truth 2, item 6: interface / abstract members are entities, so calls
 * through interface-typed receivers resolve (also across files and through
 * `extends`); members that may come from outside the project stay silent.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { indexFixture, findEdge, type IndexedFixture } from './harness.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/parser-truth-2');
const USER = 'apps/server/src/ports-user.ts';
const PORTS = 'packages/core/src/ports.ts';

let fx: IndexedFixture | null = null;
afterEach(async () => { await fx?.cleanup(); fx = null; });

describe('interface and abstract members', () => {
  it('extracts callable signatures as method entities, skipping data members and accessors', async () => {
    fx = await indexFixture(FIXTURE);
    const members = fx.nodes.filter((n) => n.file === PORTS && n.kind === 'method').map((n) => `${n.qualified_name.slice(PORTS.length + 1)} ${n.annotations?.signature ?? ''}`.trim()).sort();
    expect(members).toEqual(['Channel.open interface', 'Clock.now interface', 'Registry.get interface', 'Registry.save interface', 'Worker.run abstract', 'Worker.start']);
    expect(findEdge(fx, 'contain', `${PORTS}/Registry`, `${PORTS}/Registry.save`)).toBeDefined();
    expect(findEdge(fx, 'extend', `${PORTS}/Registry`, `${PORTS}/Clock`)).toBeDefined();
  });

  it('resolves calls through an interface-typed receiver, including members inherited via extends', async () => {
    fx = await indexFixture(FIXTURE);
    const lookup = `${USER}/lookup`;
    expect(findEdge(fx, 'call', lookup, `${PORTS}/Registry.save`)?.meta?.receiver).toBe('reg');
    expect(findEdge(fx, 'call', lookup, `${PORTS}/Registry.get`)).toBeDefined();
    expect(findEdge(fx, 'call', lookup, `${PORTS}/Clock.now`)).toBeDefined(); // declared on the base interface
  });

  it('resolves abstract methods and members inherited from an abstract base', async () => {
    fx = await indexFixture(FIXTURE);
    expect(findEdge(fx, 'call', `${PORTS}/Worker.start`, `${PORTS}/Worker.run`)).toBeDefined();
    expect(findEdge(fx, 'call', `${USER}/wire`, `${PORTS}/Worker.start`)).toBeDefined(); // Mailer extends Worker
    expect(findEdge(fx, 'call', `${USER}/wire`, `${USER}/Mailer.run`)).toBeDefined();
    expect(findEdge(fx, 'call', `${USER}/wire`, `${PORTS}/Channel.open`)).toBeDefined(); // declared on the interface itself
  });

  it('does not report members of external bases or aliases of external types as unresolved', async () => {
    fx = await indexFixture(FIXTURE);
    const leaves = fx.unresolved.map((u) => u.target_name);
    expect(leaves).not.toContain('Channel.listenerCount'); // interface Channel extends EventEmitter (another file)
    expect(leaves).not.toContain('Database.prepare'); // type Database = DatabaseSync
    expect(fx.edges.some((e) => e.type === 'call' && fx!.byId.get(e.to)?.name === 'listenerCount')).toBe(false);
  });
});
