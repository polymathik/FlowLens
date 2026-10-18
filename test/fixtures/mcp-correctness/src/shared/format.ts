// Five same-file callers of `format` give get_dependents/traverse a known fan-in.
export function format(value: string): string {
  if (value.length === 0) {
    return '';
  }
  return value.trim();
}

export function formatName(name: string): string {
  return format(name);
}

export function formatTitle(title: string): string {
  return format(title).toUpperCase();
}

export function formatLabel(label: string): string {
  return format(label) + ':';
}

export function formatPath(path: string): string {
  return format(path).replace(/\\/g, '/');
}

export function formatList(items: string[]): string {
  return items.map((i) => format(i)).join(', ');
}
