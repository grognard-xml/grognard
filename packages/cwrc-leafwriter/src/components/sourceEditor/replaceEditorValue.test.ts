import { replaceEditorValue, type ReplaceableEditor } from './replaceEditorValue';

type Fake = Record<string, unknown>;

/** A text buffer with Monaco's offset/position arithmetic, one line per "\n". */
const makeEditor = (initial: string, selections: [number, number][]) => {
  let text = initial;
  let current = selections;
  const positionAt = (offset: number) => {
    const before = text.slice(0, offset).split('\n');
    return { lineNumber: before.length, column: before[before.length - 1]!.length + 1 };
  };
  const offsetAt = (p: { lineNumber: number; column: number }) => {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < p.lineNumber - 1; i++) offset += lines[i]!.length + 1;
    return offset + p.column - 1;
  };
  const asSelection = ([anchor, active]: [number, number]) => ({
    getSelectionStart: () => positionAt(anchor),
    getPosition: () => positionAt(active),
    getStartPosition: () => positionAt(Math.min(anchor, active)),
    getEndPosition: () => positionAt(Math.max(anchor, active)),
  });
  const model = {
    getFullModelRange: () => 'full',
    getOffsetAt: offsetAt,
    getPositionAt: positionAt,
    getValueLength: () => text.length,
    setValue: (value: string) => {
      text = value;
      current = [[0, 0]];
    },
  };
  const editor = {
    getModel: () => model,
    getSelections: () => current.map(asSelection),
    setSelections: (next) => {
      current = next.map((s) => [
        offsetAt({ lineNumber: s.selectionStartLineNumber, column: s.selectionStartColumn }),
        offsetAt({ lineNumber: s.positionLineNumber, column: s.positionColumn }),
      ]);
    },
    // Monaco leaves the cursor at the end of the inserted text.
    executeEdits: (_source, edits) => {
      text = edits[0]!.text;
      current = [[text.length, text.length]];
    },
  } as unknown as ReplaceableEditor;
  return { editor, text: () => text, selections: () => current };
};

describe('replaceEditorValue', () => {
  const before = '<TEI>\n<p>one two</p>\n<p>three four</p>\n</TEI>';
  const after = '<TEI>\n<p>one two</p>\n<p>three four</p>\n</TEI>\n';

  it('throws the cursor to the end of the text when the selection is not kept', () => {
    const cursor = before.indexOf('three');
    const { editor, selections } = makeEditor(before, [[cursor, cursor]]);

    replaceEditorValue(editor, after, { keepSelection: false, resetUndo: false });

    expect(selections()).toEqual([[after.length, after.length]]);
  });

  it('keeps the cursor where it was when the same document gets new text', () => {
    const cursor = before.indexOf('three') + 2;
    const { editor, text, selections } = makeEditor(before, [[cursor, cursor]]);

    replaceEditorValue(editor, after, { keepSelection: true, resetUndo: false });

    expect(text()).toBe(after);
    expect(selections()).toEqual([[cursor, cursor]]);
  });

  it('keeps a selection and its direction', () => {
    const a = before.indexOf('one');
    const b = before.indexOf('two') + 3;
    const { editor, selections } = makeEditor(before, [[b, a]]);

    replaceEditorValue(editor, after, { keepSelection: true, resetUndo: false });

    expect(selections()).toEqual([[b, a]]);
  });

  it('clamps the cursor when the new text is shorter', () => {
    const cursor = before.length - 2;
    const { editor, selections } = makeEditor(before, [[cursor, cursor]]);

    replaceEditorValue(editor, '<TEI/>', { keepSelection: true, resetUndo: false });

    expect(selections()).toEqual([[6, 6]]);
  });

  it('keeps every cursor when there are several', () => {
    const { editor, selections } = makeEditor(before, [
      [1, 1],
      [10, 12],
    ]);

    replaceEditorValue(editor, after, { keepSelection: true, resetUndo: false });

    expect(selections()).toEqual([
      [1, 1],
      [10, 12],
    ]);
  });

  it('resetting the undo stack replaces the text with setValue and leaves the cursor alone', () => {
    const cursor = before.indexOf('three');
    const { editor, text, selections } = makeEditor(before, [[cursor, cursor]]);

    replaceEditorValue(editor, after, { keepSelection: true, resetUndo: true });

    expect(text()).toBe(after);
    expect(selections()).toEqual([[0, 0]]);
  });

  it('does nothing without a model', () => {
    const { editor } = makeEditor(before, [[0, 0]]);
    expect(() =>
      replaceEditorValue(
        { ...(editor as unknown as Fake), getModel: () => null } as unknown as ReplaceableEditor,
        after,
        {
          keepSelection: true,
          resetUndo: false,
        },
      ),
    ).not.toThrow();
  });
});
