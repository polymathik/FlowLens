/**
 * A messy pnpm-style monorepo for the Communities E2E: `packages/app` has four topics (auth, billing, search,
 * render) of about a dozen files each, but ~35% of the files live in another topic's folder, so folders do not
 * show the structure — the imports do. `packages/kit` is a small package (one zone). Real TypeScript, so the
 * indexer produces the import and call relations the file graph is built from.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { indexProject } from './fixture-project.js';

const TOPICS = ['auth', 'billing', 'search', 'render'];
const PARTS = ['service', 'store', 'model', 'view', 'cache', 'client', 'router', 'schema', 'worker', 'format', 'guard', 'loader', 'event'];

export function communitiesFiles(): Record<string, string> {
  let seed = 7;
  const next = (n: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'comm-app', private: true, workspaces: ['packages/*'] }, null, 2),
    'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
    'packages/app/package.json': JSON.stringify({ name: '@comm/app', version: '1.0.0' }, null, 2),
    'packages/kit/package.json': JSON.stringify({ name: '@comm/kit', version: '1.0.0' }, null, 2),
  };
  const place = (pkg: string, topic: string, i: number, scatter: boolean): { path: string; name: string } => {
    const home = scatter && next(100) < 35 ? TOPICS[next(TOPICS.length)] : topic;
    return { path: `packages/${pkg}/src/${home}/${topic}-${PARTS[i % PARTS.length]}${i >= PARTS.length ? i : ''}.ts`, name: `${topic}${PARTS[i % PARTS.length][0].toUpperCase()}${PARTS[i % PARTS.length].slice(1)}${i}` };
  };
  const cluster = (pkg: string, topic: string, size: number, scatter: boolean): void => {
    const members = Array.from({ length: size }, (_, i) => place(pkg, topic, i, scatter));
    members.forEach((m, i) => {
      const targets = new Set<number>();
      if (i > 0) targets.add(next(i));
      for (let k = 0; k < 2; k++) targets.add(next(size));
      targets.delete(i);
      const imports = [...targets].map((t) => `import { ${members[t].name} } from '${posix.relative(posix.dirname(m.path), members[t].path.replace(/\.ts$/, '')).replace(/^(?!\.)/, './')}';`);
      const calls = [...targets].map((t) => `${members[t].name}(n)`);
      files[m.path] = `${imports.join('\n')}${imports.length ? '\n\n' : ''}export function ${m.name}(n: number): number {\n  return n + ${calls.length ? calls.join(' + ') : '1'};\n}\n`;
    });
    const test = `packages/${pkg}/test/${topic}.test.ts`;
    const rel = (t: number): string => posix.relative(posix.dirname(test), members[t].path.replace(/\.ts$/, ''));
    files[test] = `import { ${members[0].name} } from '${rel(0)}';\nimport { ${members[1].name} } from '${rel(1)}';\n\nexport const ${topic}Smoke = (): number => ${members[0].name}(1) + ${members[1].name}(2);\n`;
  };
  TOPICS.forEach((t, i) => cluster('app', t, 12 + (i % 2), true));
  cluster('kit', 'kit', 7, false);
  return files;
}

export async function createCommunitiesProject(parent: string): Promise<{ rootDir: string; flowlensDir: string }> {
  const rootDir = join(parent, 'comm-app');
  for (const [rel, text] of Object.entries(communitiesFiles())) {
    await mkdir(dirname(join(rootDir, rel)), { recursive: true });
    await writeFile(join(rootDir, rel), text);
  }
  return { rootDir, flowlensDir: await indexProject(rootDir) };
}
