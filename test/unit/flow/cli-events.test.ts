import { describe, it, expect } from 'vitest';
import { detectEntryPoints } from '../../../src/flow/entry-points.js';
import { buildGraph, type FileSpec } from '../../helpers/flow-graph.js';

const run = (files: Record<string, FileSpec>) => {
  const b = buildGraph(files);
  return { b, eps: detectEntryPoints(b.graph, b.source) };
};
const labels = (eps: ReturnType<typeof run>['eps'], kind: string) => eps.filter((e) => e.kind === kind).map((e) => e.label).sort();

describe('CLI commands', () => {
  it('commander chains: named handler, inline handler, groups via addCommand (chain and statement form)', () => {
    const text = [
      "import { Command } from 'commander';",
      'const program = new Command();',
      'function runServe() {}',
      "program.command('serve <dir>').description('x').option('-p').action(runServe);",
      "program.command('seed').action(async () => {",
      '  await seed();',
      '});',
      "const history = new Command('history').description('h').addCommand(buildCmd);",
      "const buildCmd = new Command('build').action(() => {});",
      "const db = new Command('db');",
      "const migrate = new Command('migrate').action(() => {});",
      'db.addCommand(migrate);',
      'program.addCommand(db);',
    ].join('\n');
    const { eps, b } = run({ 'src/cli.ts': { text, symbols: [{ qn: 'runServe', line: 3 }, { qn: 'buildCmd', kind: 'variable', line: 9 }] } });
    expect(labels(eps, 'cli_command')).toEqual(['cli: db migrate', 'cli: history build', 'cli: seed', 'cli: serve']);
    const serve = eps.find((e) => e.label === 'cli: serve');
    expect(serve).toMatchObject({ entity_id: b.id('src/cli.ts/runServe'), line: 4, confidence: 0.9 });
    expect(eps.find((e) => e.label === 'cli: seed')).toMatchObject({ entity_id: b.id('src/cli.ts'), span: { line_start: 5, line_end: 7 } });
  });

  it('yargs handlers and cac/sade chains; files without a CLI library are ignored', () => {
    const yargsText = "import yargs from 'yargs';\nyargs(argv).command('start', 'Start it', (y) => y, handleStart).command('stop', 'Stop', {}, () => {}).parse();\nfunction handleStart(){}";
    const cacText = "import cac from 'cac';\nconst cli = cac();\ncli.command('build [root]').action(run);\nfunction run(){}";
    const none = "const x = thing.command('nope').action(f);";
    const { eps } = run({
      'src/y.ts': { text: yargsText, symbols: [{ qn: 'handleStart', line: 3 }] },
      'src/c.ts': { text: cacText, symbols: [{ qn: 'run', line: 4 }] },
      'src/n.ts': { text: none },
    });
    expect(labels(eps, 'cli_command')).toEqual(['cli: build', 'cli: start', 'cli: stop']);
  });
});

describe('manifest, main, UI and event entry points', () => {
  it('bin / scripts / main from package.json, mapping built files back to source', () => {
    const { eps } = run({
      'package.json': { language: 'json', role: 'config', text: JSON.stringify({ name: '@acme/tool', bin: { tool: './dist/cli.js' }, scripts: { seed: 'tsx scripts/seed.ts', start: 'node dist/server.js', lint: 'eslint .' }, main: 'dist/index.js' }) },
      'src/cli.ts': {}, 'scripts/seed.ts': {}, 'src/server.ts': {},
      'src/index.ts': { symbols: [{ qn: 'doIt' }, { qn: 'Thing', kind: 'class' }, { qn: 'hidden', line: 5, visibility: 'internal' }] },
    });
    const by = (k: string) => eps.filter((e) => e.kind === k);
    expect(by('bin')).toHaveLength(1);
    expect(by('bin')[0]).toMatchObject({ label: 'bin: tool', qualified_name: 'src/cli.ts', confidence: 0.85 });
    expect(by('bin')[0].evidence).toContain('built output');
    expect(by('main').map((e) => e.label).sort()).toEqual(['script: seed', 'script: start']);
    expect(by('export_api').map((e) => e.label).sort()).toEqual(['api: Thing', 'api: doIt()']);
  });

  it('a barrel is followed through re-exports', () => {
    const b = buildGraph({
      'package.json': { language: 'json', role: 'config', text: JSON.stringify({ name: 'lib', main: 'src/index.ts' }) },
      'src/index.ts': {}, 'src/impl.ts': { symbols: [{ qn: 'work' }] },
    }, [{ from: 'src/index.ts', to: 'src/impl.ts', type: 'import', meta: { reexport: true } }]);
    expect(detectEntryPoints(b.graph, b.source).map((e) => e.label)).toEqual(['api: work()']);
  });

  it('main functions per language, direct-execution guards, and no duplicate when a bin file has main()', () => {
    const { eps } = run({
      'cmd/app/main.go': { language: 'go', symbols: [{ qn: 'main' }] },
      'tool.py': { language: 'python', text: "def main():\n  pass\n\nif __name__ == '__main__':\n  main()\n", symbols: [{ qn: 'main' }] },
      'src/guard.ts': { text: 'export function boot(){}\nif (require.main === module) boot();\n' },
      'package.json': { language: 'json', role: 'config', text: JSON.stringify({ name: 'p', bin: 'src/bin.ts' }) },
      'src/bin.ts': { symbols: [{ qn: 'main' }] },
    });
    expect(eps.filter((e) => e.kind === 'main').map((e) => `${e.label}|${e.confidence}`).sort()).toEqual(['main: guard.ts|0.85', 'main: main.go|0.9', 'main: tool.py|0.7'].sort());
    expect(eps.filter((e) => e.kind === 'bin')).toHaveLength(1);
  });

  it('UI roots (React, Vue, Svelte) and event listeners (module scope or well-known emitters)', () => {
    const b = buildGraph({
      'ui/main.tsx': { language: 'tsx', text: "import { App } from './App';\ncreateRoot(el).render(<React.StrictMode><App /></React.StrictMode>);", },
      'ui/App.tsx': { language: 'tsx', symbols: [{ qn: 'App' }] },
      'v/main.ts': { text: "import App from './App.vue';\ncreateApp(App).mount('#app');" },
      'v/App.vue': { symbols: [{ qn: 'App', kind: 'component' }] },
      'src/ev.ts': { text: "function onSig(){}\nprocess.on('SIGINT', onSig);\nexport function setup(){\n  emitter.on('x', () => {});\n  window.addEventListener('resize', onSig);\n}", symbols: [{ qn: 'onSig', line: 1 }, { qn: 'setup', line: 3, end: 6 }] },
    }, [{ from: 'ui/main.tsx', to: 'ui/App.tsx', type: 'import' }, { from: 'v/main.ts', to: 'v/App.vue', type: 'import' }]);
    const eps = detectEntryPoints(b.graph, b.source);
    expect(labels(eps, 'ui_component_root')).toEqual(['ui: <App>', 'ui: <App>']);
    expect(labels(eps, 'event_handler')).toEqual(["on process 'SIGINT'", "on window 'resize'"]);
  });

  it('flags test files (excluded from the default listing elsewhere)', () => {
    const { eps } = run({ 'test/a.test.ts': { role: 'test' }, 'src/a.ts': {} });
    expect(eps.map((e) => `${e.kind}|${e.label}`)).toEqual(['test|test: a.test.ts']);
  });
});

describe('commander groups via addCommand(new Command(...))', () => {
  it('prefixes sub-commands added inline to a group variable, nested through several groups', () => {
    const text = [
      "import { Command } from 'commander';",
      "export const agentCommand = new Command('agent');",
      "agentCommand.addCommand(new Command('context')",
      '  .action(() => runContext()));',
      "const installCommand = new Command('install');",
      "installCommand.addCommand(new Command('claude-code')",
      '  .action(() => runInstall()));',
      'agentCommand.addCommand(installCommand);',
      'function runContext() {}',
      'function runInstall() {}',
      '',
    ].join('\n');
    const b = buildGraph({ 'src/agent.ts': { text, symbols: [{ qn: 'runContext', line: 9 }, { qn: 'runInstall', line: 10 }] } });
    const labels = detectEntryPoints(b.graph, b.source).filter((e) => e.kind === 'cli_command').map((e) => e.label).sort();
    expect(labels).toEqual(['cli: agent context', 'cli: agent install claude-code']);
  });
});
