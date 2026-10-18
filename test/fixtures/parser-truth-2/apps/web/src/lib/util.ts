import { formatName } from '#lib/format.js';
import { parseId } from '@pt/core';
import { writeTextPref } from '#built/prefs.js';

export function title(raw: string): string {
  writeTextPref('last', raw);
  return formatName(parseId(raw) ?? 'untitled');
}
