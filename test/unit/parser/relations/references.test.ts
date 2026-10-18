/**
 * Parser truth 2, item 5: identifiers handed to other code (call arguments,
 * route tables) and JSX usage become `use` / `create` edges from the owner.
 */
import { describe, it, expect } from 'vitest';
import { parseSource } from '../../../helpers/parse-relations.js';

const TYPES = ['use', 'create'] as const;

describe('handler references as call arguments', () => {
  it('links module-scope registrations to the file entity with ref/ref_via', async () => {
    const p = await parseSource([
      'function listSessions() {}',
      'function auth() {}',
      'app.get("/x", listSessions);',
      'app.post("/y", [auth, listSessions]);',
      '[1, 2].map(listSessions);',
    ].join('\n'));
    expect(p.lines([...TYPES])).toEqual([
      'use src/a.ts -> auth [module] ~argument:app.post',
      'use src/a.ts -> listSessions [module] x3 ~argument:app.get',
    ]);
    const r = p.relations.find((x) => x.type === 'use' && x.weight === 3)!;
    expect(r.meta?.sites?.map((s) => s.line)).toEqual([3, 4, 5]);
  });

  it('names `.method` as the callee for a call on a non-trivial receiver', async () => {
    const p = await parseSource('function fmt() {}\n[1].map(fmt);\n');
    expect(p.lines(['use'])).toEqual(['use src/a.ts -> fmt [module] ~argument:.map']);
  });

  it('handles references inside functions, `new` arguments and this.method', async () => {
    const p = await parseSource([
      'function auth() {}',
      'class Hub { onEvent() {} bind(el) { el.addEventListener("x", this.onEvent); } }',
      'function outer(items) { items.forEach(auth); new Hub(auth); }',
    ].join('\n'));
    expect(p.lines([...TYPES])).toEqual([
      'create outer -> Hub',
      'use Hub.bind -> Hub.onEvent ~argument:el.addEventListener',
      'use outer -> auth x2 ~argument:items.forEach',
    ]);
  });

  it('resolves handler references through imports (pending, optional)', async () => {
    const p = await parseSource([
      'import { onShutdown } from "./boot.js";',
      'import { external } from "left-pad";',
      'process.on("SIGTERM", onShutdown);',
      'process.on("x", external);',
    ].join('\n'));
    expect(p.lines(['use'])).toEqual(['use src/a.ts -> ?onShutdown [module] ~argument:process.on']);
    expect(p.pending.find((r) => r.type === 'use')?.optional).toBe(true);
  });

  it('registers route tables: export default / module.exports / exported arrays', async () => {
    const p = await parseSource([
      'function run() {}',
      'function stop() {}',
      'export default { run };',
      'export const routes = [{ path: "/z", handler: stop }];',
    ].join('\n'));
    expect(p.lines(['use'])).toEqual([
      'use src/a.ts -> run [module] ~table',
      'use src/a.ts -> stop [module] ~table',
    ]);
  });

  it('ignores shadowed names, object keys and plain values at module scope', async () => {
    const p = await parseSource([
      'const CONFIG = { a: 1 };',
      'function run() {}',
      'function inner(run) { use(run); }',
      'function other() { const run = 1; use(run); }',
      'const t = { run: 1 };',
      'boot(CONFIG);',
      'const alias = run;',
    ].join('\n'));
    expect(p.lines(['use'])).toEqual([]);
  });

  it('inside a function a variable argument still yields the use edge it always did', async () => {
    const p = await parseSource('const CONFIG = { a: 1 };\nfunction f() { boot(CONFIG); }\n');
    expect(p.lines(['use'])).toEqual(['use f -> CONFIG ~argument:boot']);
  });
});

describe('JSX', () => {
  const tsx = (code: string) => parseSource(code, 'src/App.tsx');

  it('creates an edge per component element and a use per handler attribute', async () => {
    const p = await tsx([
      'import { Button } from "./ui/Button.js";',
      'import * as ui from "./ui/index.js";',
      'function open() {}',
      'function Panel() { return <div onClick={open}><Button onClick={open} /><ui.Cell /><span /></div>; }',
      'const Row = () => <Panel />;',
    ].join('\n'));
    expect(p.lines([...TYPES])).toEqual([
      'create Panel -> ?Button',
      'create Panel -> ?ui.Cell',
      'create Row -> Panel',
      'use Panel -> open x2 ~binding:onClick',
    ]);
  });

  it('attributes elements in anonymous default exports and top-level JSX to the file entity', async () => {
    const p = await tsx('function Row() { return null; }\nexport default () => <Row />;\nconst el = <Row />;\n');
    expect(p.lines(['create'])).toEqual(['create src/App.tsx -> Row [module] x2']);
  });

  it('skips external components, DOM tags and parameters that shadow a component', async () => {
    const p = await tsx([
      'import { Icon } from "some-lib";',
      'function Panel() { return <Icon />; }',
      'function Shadow(Panel) { return <Panel />; }',
      'function Dom() { return <section><Panel2 /></section>; }',
    ].join('\n'));
    expect(p.lines(['create'])).toEqual([]);
  });

  it('only function-valued props count for non-handler attributes', async () => {
    const p = await tsx([
      'const label = "x";',
      'function draw() {}',
      'function View() { return <Chart title={label} render={draw} onTick={label} />; }',
    ].join('\n'));
    expect(p.lines(['use'])).toEqual(['use View -> draw ~binding:render', 'use View -> label ~binding:onTick']);
  });
});
