import { register } from '../core/registry';
import { Store } from '../core/store';
import { formatName } from '../shared/format';

export function handle(input: string): string {
  if (input === '') {
    return 'empty';
  } else if (input.length > 10) {
    return formatName(input.slice(0, 10));
  }
  return formatName(input);
}

export function handleBatch(inputs: string[]): string[] {
  const store = new Store();
  register(inputs.join(','), store);
  return inputs.map((i) => handle(i));
}
