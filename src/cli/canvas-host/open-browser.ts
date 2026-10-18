/**
 * Best-effort "open this URL in the default browser" without a dependency.
 * Failures are swallowed: the URL is always printed for the user anyway.
 */
import { spawn } from 'node:child_process';

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* no browser available (CI, SSH) — ignore */
  }
}
