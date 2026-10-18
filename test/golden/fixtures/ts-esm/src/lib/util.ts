export function helper(x: number): number {
  return x * 2;
}

export function format(value: string, width: number): string {
  return value.padEnd(width);
}
