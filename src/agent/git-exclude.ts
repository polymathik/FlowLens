/**
 * Keep `.claude/settings.local.json` out of git. Claude Code adds it to the
 * global excludes only when *it* creates the file; when FlowLens creates it
 * the docs say to ignore it yourself (code.claude.com/docs/en/settings,
 * "Project local"). We append it to the repository's own `.git/info/exclude`
 * (never a committed file) when git does not ignore it already.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { realpathSync } from 'node:fs';

export const LOCAL_SETTINGS_PATTERN = '/.claude/settings.local.json';

function git(cwd: string, args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  } catch (err) {
    return { code: (err as { status?: number }).status ?? -1, out: '' };
  }
}

export type GitIgnoreOutcome =
  | { kind: 'already'; via: string }
  | { kind: 'added'; via: string }
  | { kind: 'not_git' }
  | { kind: 'failed'; message: string };

/** Make sure git ignores `<projectDir>/.claude/settings.local.json`. */
export function ensureLocalSettingsIgnored(projectDir: string): GitIgnoreOutcome {
  return ensurePathIgnored(projectDir, '.claude/settings.local.json', 'personal Claude Code settings');
}

/**
 * Make sure git ignores `<projectDir>/<rel>` (`rel` uses `/`), by appending to `.git/info/exclude` (never a
 * committed file) unless an ignore rule already covers it. A tracked file is never excluded by this.
 */
export function ensurePathIgnored(projectDir: string, rel: string, comment: string): GitIgnoreOutcome {
  const top = git(projectDir, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0 || !top.out) return { kind: 'not_git' };
  if (git(projectDir, ['ls-files', '--error-unmatch', rel]).code === 0) return { kind: 'already', via: 'tracked file (not excluded)' };
  const check = git(projectDir, ['check-ignore', '-q', '--no-index', rel]);
  if (check.code === 0) return { kind: 'already', via: 'git ignore rules' };
  const raw = git(projectDir, ['rev-parse', '--git-path', 'info/exclude']).out;
  if (!raw) return { kind: 'failed', message: 'cannot locate .git/info/exclude' };
  const exclude = isAbsolute(raw) ? raw : join(projectDir, raw);
  // The pattern is relative to the repository root; the project may be a subfolder.
  let dir = projectDir;
  try { dir = realpathSync.native(projectDir); } catch { /* keep as given */ }
  const prefix = dir === top.out || !dir.startsWith(top.out) ? '' : `/${dir.slice(top.out.length + 1).replaceAll('\\', '/')}`;
  const pattern = `${prefix}/${rel}`;
  try {
    mkdirSync(dirname(exclude), { recursive: true });
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf-8') : '';
    if (!current.split(/\r?\n/).includes(pattern)) {
      appendFileSync(exclude, `${current === '' || current.endsWith('\n') ? '' : '\n'}# FlowLens: ${comment}\n${pattern}\n`);
    }
    return { kind: 'added', via: exclude };
  } catch (err) {
    return { kind: 'failed', message: (err as Error).message };
  }
}
