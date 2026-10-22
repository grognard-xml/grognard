import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

/** The part of Monaco's editor this needs. */
export type ReplaceableEditor = Pick<
  monaco.editor.IStandaloneCodeEditor,
  'executeEdits' | 'getModel' | 'getSelections' | 'setSelections'
>;

/**
 * Replaces the whole text of the editor with `value`. Monaco leaves the cursor at the end of the
 * inserted text after a replacement like this, so a sync that arrives after the cursor was put
 * somewhere (or while the scholar is working) would throw it to the end of the document, and
 * leaving Source mode would then carry that end position over to the Visual editor. When the
 * text is that of the same document, the selections are put back at the same offsets, clamped to
 * the new length. `resetUndo` uses `setValue`, which clears the undo stack and the selection.
 */
export const replaceEditorValue = (
  editor: ReplaceableEditor,
  value: string,
  options: { keepSelection: boolean; resetUndo: boolean },
): void => {
  const model = editor.getModel();
  if (!model) return;

  const saved = options.keepSelection
    ? (editor.getSelections() ?? []).map((selection) => ({
        anchor: model.getOffsetAt(selection.getSelectionStart()),
        active: model.getOffsetAt(selection.getPosition()),
      }))
    : [];

  if (options.resetUndo) {
    model.setValue(value);
  } else {
    editor.executeEdits('external-sync', [
      { range: model.getFullModelRange(), text: value, forceMoveMarkers: true },
    ]);
  }

  if (!options.keepSelection || options.resetUndo || saved.length === 0) return;

  const length = model.getValueLength();
  editor.setSelections(
    saved.map(({ anchor, active }) => {
      const start = model.getPositionAt(Math.min(anchor, length));
      const end = model.getPositionAt(Math.min(active, length));
      return {
        selectionStartLineNumber: start.lineNumber,
        selectionStartColumn: start.column,
        positionLineNumber: end.lineNumber,
        positionColumn: end.column,
      };
    }),
  );
};
