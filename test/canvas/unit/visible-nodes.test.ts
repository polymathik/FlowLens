import { describe, it, expect } from 'vitest';
import { transformEntitiesToNodes } from '../../../src/canvas/utils/node-transformer.js';
import { drillPathForNode, getVisibleNodes, nodeSetKey } from '../../../src/canvas/utils/visible-nodes.js';
import { sampleGraph } from '../helpers/factories.js';

const nodes = transformEntitiesToNodes(sampleGraph().entities);
const visible = (path: string[]) => getVisibleNodes(nodes, path).map((n) => n.id).sort();
const node = (id: string) => nodes.find((n) => n.id === id)!;

describe('getVisibleNodes', () => {
  it('root shows only systems', () => {
    expect(visible([])).toEqual(['system:lib', 'system:src']);
  });

  it('system shows its modules, its root files and the other systems, not itself', () => {
    expect(visible(['system:src'])).toEqual(['file:src/index.ts', 'module:src/api', 'module:src/core', 'module:src/ui', 'system:lib']);
  });

  it('module shows its files and its sibling modules, not itself', () => {
    expect(visible(['system:src', 'module:src/ui'])).toEqual([
      'file:src/ui/view.ts',
      'file:src/ui/widgets.ts',
      'module:src/api',
      'module:src/core',
    ]);
  });

  it('file shows its symbols', () => {
    expect(visible(['system:src', 'module:src/core', 'file:src/core/store.ts'])).toEqual(['Store']);
  });

  it('a symbol id at the end of the path falls back to its parent level, never to all nodes', () => {
    const fileLevel = visible(['system:src', 'module:src/core', 'file:src/core/store.ts']);
    expect(visible(['system:src', 'module:src/core', 'file:src/core/store.ts', 'Store'])).toEqual(fileLevel);
    expect(getVisibleNodes(nodes, ['Store']).length).toBeLessThan(nodes.length);
  });
});

describe('drillPathForNode', () => {
  it('builds the path from node ancestry (sibling module replaces the current one)', () => {
    expect(drillPathForNode(node('system:src'))).toEqual(['system:src']);
    expect(drillPathForNode(node('module:src/api'))).toEqual(['system:src', 'module:src/api']);
    expect(drillPathForNode(node('file:src/ui/view.ts'))).toEqual(['system:src', 'module:src/ui', 'file:src/ui/view.ts']);
    expect(drillPathForNode(node('file:src/index.ts'))).toEqual(['system:src', 'file:src/index.ts']);
  });

  it('symbols are not drillable', () => {
    expect(drillPathForNode(node('Store'))).toBeNull();
  });
});

describe('nodeSetKey', () => {
  it('changes when membership changes even if the size does not', () => {
    const a = nodeSetKey([{ id: 'x' }, { id: 'y' }]);
    expect(nodeSetKey([{ id: 'y' }, { id: 'x' }])).toBe(a);
    expect(nodeSetKey([{ id: 'x' }, { id: 'z' }])).not.toBe(a);
  });
});
