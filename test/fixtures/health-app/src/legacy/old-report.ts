export function oldReport(rows: number[]): number {
  let total = 0;
  for (const r of rows) total += r;
  return total;
}
