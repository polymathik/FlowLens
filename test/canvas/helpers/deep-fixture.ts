/**
 * A small pnpm-style monorepo for the Map hierarchy E2E: two packages, a
 * 3-level deep folder chain, a file without symbols, config files and a
 * lockfile, and cross-package imports/calls (portal edges).
 *
 *   packages/core/src/domain/billing/invoices/{calc,tax}.ts   (3 levels under src)
 *   packages/web/src/{app,pages/home,side-effects}.ts          (web → core links)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { indexProject } from './fixture-project.js';

export const DEEP_APP: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'deep-app', private: true, workspaces: ['packages/*'] }, null, 2),
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
  'packages/core/package.json': JSON.stringify({ name: '@deep/core', version: '1.0.0' }, null, 2),
  'packages/core/tsconfig.json': '{ "extends": "../../tsconfig.json" }\n',
  'packages/core/src/index.ts': "export { total } from './domain/billing/invoices/calc';\nexport { taxFor } from './domain/billing/invoices/tax';\n",
  'packages/core/src/domain/billing/invoices/tax.ts':
    'export function taxFor(amount: number): number {\n  return amount * 0.2;\n}\n\nexport function roundTax(amount: number): number {\n  return Math.round(taxFor(amount) * 100) / 100;\n}\n',
  'packages/core/src/domain/billing/invoices/calc.ts':
    "import { taxFor } from './tax';\n\nexport interface Line {\n  price: number;\n  qty: number;\n}\n\nexport function total(lines: Line[]): number {\n  return lines.reduce((sum, l) => sum + l.price * l.qty + taxFor(l.price * l.qty), 0);\n}\n\nexport function subtotal(lines: Line[]): number {\n  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);\n}\n",
  'packages/core/src/domain/billing/receipt.ts': "import { total } from './invoices/calc';\n\nexport function receipt(lines: { price: number; qty: number }[]): string {\n  return `Total: ${total(lines)}`;\n}\n",
  'packages/web/package.json': JSON.stringify({ name: '@deep/web', version: '1.0.0' }, null, 2),
  'packages/web/src/app.ts':
    "import { total, subtotal } from '../../core/src/domain/billing/invoices/calc';\nimport { taxFor } from '../../core/src/domain/billing/invoices/tax';\nimport { renderHome } from './pages/home';\n\nexport function startApp(): string {\n  const lines = [{ price: 2, qty: 3 }];\n  return renderHome(total(lines), subtotal(lines), taxFor(6));\n}\n",
  'packages/web/src/pages/home.ts': 'export function renderHome(a: number, b: number, c: number): string {\n  return `${a}/${b}/${c}`;\n}\n',
  'packages/web/src/side-effects.ts': "import './app';\n",
};

export async function createDeepProject(parent: string): Promise<{ rootDir: string; flowlensDir: string }> {
  const rootDir = join(parent, 'deep-app');
  for (const [rel, text] of Object.entries(DEEP_APP)) {
    await mkdir(dirname(join(rootDir, rel)), { recursive: true });
    await writeFile(join(rootDir, rel), text);
  }
  return { rootDir, flowlensDir: await indexProject(rootDir) };
}
