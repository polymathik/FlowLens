/**
 * File role inference (pure, path-based). Used when the indexer does not
 * provide a `file_role` hint (lane M0 adds one additively); the hint always
 * wins when it is a role we know.
 *
 * Only `config` and `lockfile` change how the Map groups files (the muted
 * "Config" pseudo-folder); the other roles are labels.
 */
import type { FileRole } from '../../contracts/hierarchy.js';

const ROLES: ReadonlySet<string> = new Set<FileRole>(['source', 'test', 'config', 'lockfile', 'docs', 'asset', 'declaration']);

const LOCKFILES: ReadonlySet<string> = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'cargo.lock', 'poetry.lock', 'pipfile.lock', 'uv.lock', 'gemfile.lock', 'composer.lock', 'go.sum',
  'mix.lock', 'pubspec.lock', 'packages.lock.json', 'flake.lock',
]);

const CONFIG_EXT: ReadonlySet<string> = new Set(['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties']);
const ASSET_EXT: ReadonlySet<string> = new Set([
  'css', 'scss', 'sass', 'less', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'html',
]);
const DOC_EXT: ReadonlySet<string> = new Set(['md', 'mdx', 'rst', 'txt', 'adoc']);

/** Basenames (lower-case) of tool configuration written in code (`vite.config.ts`, `.eslintrc.cjs`, …). */
const CODE_CONFIG = /^(?:\.[\w.-]*rc(?:\.[cm]?[jt]s|\.json|\.ya?ml)?|[\w.-]*\.config(?:\.[\w-]+)?\.[cm]?[jt]s|[\w.-]*\.setup\.[cm]?[jt]s|jest\.setup\.[cm]?[jt]s|babel\.config\.[cm]?js|svelte\.config\.[cm]?js)$/;
const TEST_FILE = /(?:^|[./_-])(?:test|spec)s?\.[^/]+$|(?:^|\/)(?:__tests__|__mocks__|tests?|spec)\//;

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return (i >= 0 ? path.slice(i + 1) : path).toLowerCase();
}

function ext(base: string): string {
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1) : '';
}

/** Role of a file from its path (lower-case comparison; never throws). */
export function inferFileRole(path: string): FileRole {
  const p = path.replace(/\\/g, '/');
  const base = baseName(p);
  if (LOCKFILES.has(base)) return 'lockfile';
  if (base.endsWith('.d.ts') || base.endsWith('.d.mts') || base.endsWith('.d.cts')) return 'declaration';
  if (TEST_FILE.test(p.toLowerCase())) return 'test';
  const e = ext(base);
  if (CODE_CONFIG.test(base)) return 'config';
  if (CONFIG_EXT.has(e)) return 'config';
  // Dotfiles without an extension (.gitignore, .npmrc, .env.local) are configuration.
  if (base.startsWith('.') && e === '') return 'config';
  if (base === 'dockerfile' || base === 'makefile') return 'config';
  if (ASSET_EXT.has(e)) return 'asset';
  if (DOC_EXT.has(e)) return 'docs';
  return 'source';
}

/** The indexer's hint when it names a known role, else the path-based guess. */
export function resolveFileRole(path: string, hint?: string): FileRole {
  return hint && ROLES.has(hint) ? (hint as FileRole) : inferFileRole(path);
}

/** Roles that live in the muted Config group. */
export const isConfigRole = (r: FileRole): boolean => r === 'config' || r === 'lockfile';
