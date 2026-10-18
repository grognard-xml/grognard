import type { Bookmark, Editor } from 'tinymce/tinymce';

/**
 * The two parts of the editor this module uses. Spelled out here, rather than taken from
 * `LeafWriterEditor` in '../types', because that module reaches the whole editor: through
 * `runAiPunctuate` it made the main process's type-check compile all of it.
 */
export type CapturableEditor = Pick<Editor, 'selection'> & { currentBookmark?: Bookmark };

/** Plain-text editor selection captured on toolbar mousedown (before focus leaves TinyMCE). */
let capturedPlain = '';

export function captureEditorSelectionFromEditor(editor: CapturableEditor): void {
  if (editor.selection.isCollapsed?.()) {
    capturedPlain = '';
    return;
  }
  editor.currentBookmark = editor.selection.getBookmark(1);
  const text = editor.selection.getContent({ format: 'text' }) ?? '';
  capturedPlain = text.replace(/\s+/g, '');
}

export function peekCapturedEditorSelection(): string {
  return capturedPlain;
}

export function consumeCapturedEditorSelection(): string {
  const text = capturedPlain;
  capturedPlain = '';
  return text;
}
