/** Parser truth 2, item 6: the first string argument of a decorator is kept as `annotations.arg`. */
import { describe, it, expect } from 'vitest';
import { parseSource } from '../../helpers/parse-relations.js';

describe('decorator string arguments', () => {
  it('keeps the path / name literal of decorator calls, nothing for bare decorators or other arguments', async () => {
    const p = await parseSource([
      "@Controller('cats')",
      'class Cats {',
      "  @Get(':id') one() {}",
      "  @Post() add() {}",
      '  @Inject(TOKEN) dep: unknown;',
      '  @Sealed hidden() {}',
      '}',
    ].join('\n'));
    const args = p.entities.filter((e) => e.kind === 'decorator').map((e) => `${e.name} ${e.annotations?.arg ?? '-'}`).sort();
    expect(args).toEqual(['Controller cats', 'Get :id', 'Inject -', 'Post -', 'Sealed -']);
  });
});
