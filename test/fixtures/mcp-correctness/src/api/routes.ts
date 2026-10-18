import { handle, handleBatch } from './handler';
import { formatTitle } from '../shared/format';

export function route(path: string): string {
  if (path.startsWith('/batch')) {
    return handleBatch(path.split('/')).join('');
  }
  return formatTitle(handle(path));
}
