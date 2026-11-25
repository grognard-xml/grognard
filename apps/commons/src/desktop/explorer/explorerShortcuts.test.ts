import { resolveExplorerShortcut, type ExplorerKeyEvent } from './explorerShortcuts';

const press = (key: string, mods: Partial<ExplorerKeyEvent> = {}): ExplorerKeyEvent => ({
  altKey: false,
  ctrlKey: false,
  key,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('resolveExplorerShortcut on macOS', () => {
  it.each([
    ['Enter', {}, 'rename'],
    ['F2', {}, 'rename'],
    ['o', { metaKey: true }, 'open'],
    ['ArrowDown', { metaKey: true }, 'open'],
    ['ArrowUp', { metaKey: true }, 'parent'],
    ['Backspace', { metaKey: true }, 'delete'],
    ['Delete', { metaKey: true }, 'delete'],
    ['N', { metaKey: true, shiftKey: true }, 'newFolder'],
  ] as const)('%s with %j -> %s', (key, mods, expected) => {
    expect(resolveExplorerShortcut(press(key, mods), true)).toBe(expected);
  });

  it('does not delete on a bare Delete or Backspace, as in Finder', () => {
    expect(resolveExplorerShortcut(press('Backspace'), true)).toBeNull();
    expect(resolveExplorerShortcut(press('Delete'), true)).toBeNull();
  });

  it('ignores plain arrows and other modifiers', () => {
    expect(resolveExplorerShortcut(press('ArrowDown'), true)).toBeNull();
    expect(resolveExplorerShortcut(press('Enter', { altKey: true }), true)).toBeNull();
    expect(resolveExplorerShortcut(press('o', { ctrlKey: true }), true)).toBeNull();
  });
});

describe('resolveExplorerShortcut on Windows and Linux', () => {
  it.each([
    ['F2', {}, 'rename'],
    ['Delete', {}, 'delete'],
    ['N', { ctrlKey: true, shiftKey: true }, 'newFolder'],
    ['ArrowUp', { altKey: true }, 'parent'],
  ] as const)('%s with %j -> %s', (key, mods, expected) => {
    expect(resolveExplorerShortcut(press(key, mods), false)).toBe(expected);
  });

  it('leaves Enter to the tree, which opens the item', () => {
    expect(resolveExplorerShortcut(press('Enter'), false)).toBeNull();
  });

  it('does not delete on Backspace, which Explorer uses to go back', () => {
    expect(resolveExplorerShortcut(press('Backspace'), false)).toBeNull();
  });

  it('ignores Cmd combinations', () => {
    expect(resolveExplorerShortcut(press('o', { metaKey: true }), false)).toBeNull();
  });
});
