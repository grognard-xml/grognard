import {
  bindAppearanceHistoryToEditor,
  canRedoAppearance,
  canUndoAppearance,
  clearAppearanceHistory,
  recordAppearanceChange,
  redoAppearance,
  setAppearanceDocumentPosition,
  setAppearanceFlushHandler,
  undoAppearance,
} from './appearanceHistory';

const mockUpdateTagColor = jest.fn().mockResolvedValue({ version: 1, tags: {} });
jest.mock('./tagColors', () => ({
  updateTagColor: (...args: unknown[]) => mockUpdateTagColor(...args),
}));

const change = (key: string, before: object | null, after: object | null) => ({
  rootPath: '/p',
  key,
  before,
  after,
});

describe('appearanceHistory', () => {
  beforeEach(() => {
    clearAppearanceHistory();
    setAppearanceFlushHandler(null);
    mockUpdateTagColor.mockClear();
  });

  test('undo restores the previous entry and redo reapplies the new one', async () => {
    recordAppearanceChange(change('seg', null, { highlight: '#111111' }));
    expect(await undoAppearance()).toBe(true);
    expect(mockUpdateTagColor).toHaveBeenLastCalledWith('/p', 'seg', null);
    expect(await redoAppearance()).toBe(true);
    expect(mockUpdateTagColor).toHaveBeenLastCalledWith('/p', 'seg', { highlight: '#111111' });
    expect(await redoAppearance()).toBe(false);
  });

  test('rapid changes to one rule coalesce, keeping the first before and last after', async () => {
    recordAppearanceChange(change('seg', null, { highlight: '#111111' }), 1000);
    recordAppearanceChange(change('seg', { highlight: '#111111' }, { highlight: '#222222' }), 1500);
    recordAppearanceChange(change('seg', { highlight: '#222222' }, { highlight: '#333333' }), 5000);
    await undoAppearance();
    expect(mockUpdateTagColor).toHaveBeenLastCalledWith('/p', 'seg', { highlight: '#222222' });
    await undoAppearance();
    expect(mockUpdateTagColor).toHaveBeenLastCalledWith('/p', 'seg', null);
    expect(canUndoAppearance()).toBe(false);
  });

  test('document edits made after a colour change are undone first', async () => {
    setAppearanceDocumentPosition(2);
    recordAppearanceChange(change('seg', null, { highlight: '#111111' }));
    setAppearanceDocumentPosition(3); // a text edit after the colour change
    expect(canUndoAppearance()).toBe(false);
    setAppearanceDocumentPosition(2); // the editor undid that text edit
    expect(canUndoAppearance()).toBe(true);
    await undoAppearance();
    setAppearanceDocumentPosition(1); // next undo goes to the document
    expect(canRedoAppearance()).toBe(false);
    setAppearanceDocumentPosition(2); // document redo returns to the colour step
    expect(canRedoAppearance()).toBe(true);
  });

  test('a new document edit abandons redoable colour changes', async () => {
    const handlers: Record<string, (event: { level?: unknown }) => void> = {};
    const levels = [{}, {}, {}];
    const editor = {
      on: (name: string, cb: (event: { level?: unknown }) => void) => {
        handlers[name] = cb;
      },
      undoManager: { data: levels },
    };
    bindAppearanceHistoryToEditor(editor);
    handlers.AddUndo!({ level: levels[2] });
    recordAppearanceChange(change('seg', null, { highlight: '#111111' }));
    await undoAppearance();
    expect(canRedoAppearance()).toBe(true);
    handlers.AddUndo!({ level: levels[2] });
    expect(canRedoAppearance()).toBe(false);
    handlers.Undo!({ level: levels[1] });
    recordAppearanceChange(change('date', null, { text: '#000001' }));
    handlers.ClearUndos!({});
    expect(canUndoAppearance()).toBe(false);
  });

  test('flushes a pending debounced save before applying', async () => {
    const order: string[] = [];
    setAppearanceFlushHandler(async () => {
      order.push('flush');
    });
    mockUpdateTagColor.mockImplementationOnce(async () => {
      order.push('apply');
    });
    recordAppearanceChange(change('seg', null, { highlight: '#111111' }));
    await undoAppearance();
    expect(order).toEqual(['flush', 'apply']);
  });
});
