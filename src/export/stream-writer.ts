/**
 * Write a string to a stream and resolve only once it has been handed to
 * the OS. `flowlens export` used to call `process.exit()` right after
 * `process.stdout.write()`; with a pipe as stdout (async on POSIX) that
 * dropped everything past the first 64–128 KB. Callers await this and then
 * let the process exit naturally (`process.exitCode`).
 *
 * A closed reader (`flowlens export | head`) raises EPIPE — that is the
 * reader's choice, not an export failure, so it resolves quietly.
 */
export function writeFully(stream: NodeJS.WritableStream, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error | null) => {
      if (settled) return;
      settled = true;
      // The 'error' listener stays attached: streams may emit 'error' after
      // the write callback, and an unhandled 'error' would crash the CLI.
      if (err && (err as NodeJS.ErrnoException).code !== 'EPIPE') reject(err);
      else resolve();
    };
    stream.on('error', finish);
    stream.write(data, finish);
  });
}
