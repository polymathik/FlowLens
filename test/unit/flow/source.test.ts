import { describe, it, expect } from 'vitest';
import { isInlineFunction, lineAt, lineStartsOf, matchBracket, referenceName, splitArgs, stringLiteral, trimSegment } from '../../../src/flow/source.js';

describe('matchBracket', () => {
  it('matches nested brackets and skips strings, templates and comments', () => {
    const t = "f(a, '(', `x${g(')')}`, /* ) */ h(1)) // )";
    expect(matchBracket(t, 1)).toBe(t.lastIndexOf('))') + 1);
  });
  it('returns -1 when unbalanced', () => {
    expect(matchBracket('f(a, (b)', 1)).toBe(-1);
  });
});

describe('splitArgs', () => {
  it('splits only at top level, including arrow bodies with commas', () => {
    const t = "app.get('/a,b', mw, async (req, res) => { res.json({ a: 1, b: [1, 2] }); })";
    const open = t.indexOf('(');
    const args = splitArgs(t, open, matchBracket(t, open)).map((s) => t.slice(s.start, s.end).trim());
    expect(args).toHaveLength(3);
    expect(args[0]).toBe("'/a,b'");
    expect(args[2].startsWith('async (req, res) =>')).toBe(true);
  });
  it('has no segments for an empty call and ignores a trailing comma', () => {
    expect(splitArgs('f()', 1, 2)).toHaveLength(0);
    expect(splitArgs('f(a,)', 1, 4)).toHaveLength(1);
  });
});

describe('literals and references', () => {
  it('reads plain strings and refuses interpolated templates', () => {
    expect(stringLiteral("'/x'")).toBe('/x');
    expect(stringLiteral('"/y"')).toBe('/y');
    expect(stringLiteral('`/z`')).toBe('/z');
    expect(stringLiteral('`/z/${id}`')).toBeNull();
    expect(stringLiteral('path')).toBeNull();
  });
  it('tells inline callbacks from references', () => {
    for (const s of ['(req, res) => 1', 'async (c) => c.json()', 'x => x', 'function (a) {}', 'async function h() {}']) expect(isInlineFunction(s), s).toBe(true);
    for (const s of ['handler', 'ctrl.list', 'this.list', 'list.bind(this)']) expect(isInlineFunction(s), s).toBe(false);
    expect(referenceName('ctrl.list')).toEqual({ name: 'list', qualifier: 'ctrl' });
    expect(referenceName('list.bind(this)')).toEqual({ name: 'list' });
    expect(referenceName('a(b)')).toBeNull();
  });
  it('maps offsets to 1-based lines', () => {
    const text = 'a\nbb\nccc';
    const starts = lineStartsOf(text);
    expect([lineAt(starts, 0), lineAt(starts, 2), lineAt(starts, 7)]).toEqual([1, 2, 3]);
    expect(trimSegment('  x  ', { start: 0, end: 5 })).toEqual({ start: 2, end: 3 });
  });
});
