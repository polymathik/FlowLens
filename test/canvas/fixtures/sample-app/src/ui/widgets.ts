import { viewTitle } from './view';

export function badge(text: string): string {
  return `[${viewTitle()}: ${text}]`;
}
