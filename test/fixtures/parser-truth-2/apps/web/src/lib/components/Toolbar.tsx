import { Badge } from './Badge.js';
import { formatName } from '#lib/format.js';
import { title } from '#lib/util.js';
import * as pieces from './Badge.js';

function onPick(): void {
  title('picked');
}

export function Toolbar({ formatName: custom }: { formatName?: () => string }) {
  return (
    <nav onClick={onPick} onFocus={formatName}>
      <Badge label="a" />
      <pieces.Badge label="b" />
      <span onClick={custom} />
    </nav>
  );
}
