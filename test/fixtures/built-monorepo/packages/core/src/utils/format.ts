export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}
