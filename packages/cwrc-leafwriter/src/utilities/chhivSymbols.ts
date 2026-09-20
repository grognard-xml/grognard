import type Writer from '../js/Writer';

/**
 * The palaeography symbol inventory from plugins/paleo-clever-idea.md:
 * single insertable marks, plus bracket-style pairs that wrap the current
 * selection (or insert both halves with the cursor left between them, if
 * nothing is selected). No semantic tagging here - just plain-text insertion.
 *
 * Shared between the CHHIV host module (which registers the toolbar menu)
 * and the symbol grid dialog it opens - kept in its own module rather than
 * either of those two importing from the other, which would be circular.
 */
export type ChhivSymbol =
  | { id: string; symbol: string; description: string; insert: string }
  | { id: string; symbol: string; description: string; open: string; close: string };

export const CHHIV_SYMBOLS: ChhivSymbol[] = [
  { id: 'illegible', symbol: '□', description: 'illegible character', insert: '□' },
  { id: 'damaged', symbol: '▨', description: 'damaged character', insert: '▨' },
  { id: 'lacuna', symbol: '〼', description: 'lacuna of uncertain extent', insert: '〼' },
  { id: 'ellipsis', symbol: '……', description: 'missing/illegible run', insert: '……' },
  { id: 'uncertain-fullwidth', symbol: '？', description: 'uncertain reading', insert: '？' },
  {
    id: 'uncertain-ascii',
    symbol: '?',
    description: 'uncertain reading (ASCII)',
    insert: '?',
  },
  { id: 'tentative', symbol: '*', description: 'tentative reading', insert: '*' },
  { id: 'repeat-ascii', symbol: '=', description: 'repetition/合文 mark', insert: '=' },
  {
    id: 'repeat-fullwidth',
    symbol: '＝',
    description: 'repetition/合文 mark (fullwidth)',
    insert: '＝',
  },
  {
    id: 'repeat-geta',
    symbol: '〓',
    description: 'repetition/合文 mark (geta)',
    insert: '〓',
  },
  { id: 'ink-dot', symbol: '·', description: 'ink dot', insert: '·' },
  { id: 'ink-round', symbol: '●', description: 'round ink block', insert: '●' },
  { id: 'ink-square', symbol: '■', description: 'square ink block', insert: '■' },
  { id: 'diagonal-line', symbol: '/', description: 'diagonal manuscript line', insert: '/' },
  { id: 'manuscript-line', symbol: '—', description: 'manuscript line/sign', insert: '—' },
  { id: 'manuscript-perp', symbol: '⊥', description: 'manuscript sign', insert: '⊥' },
  {
    id: 'manuscript-colon',
    symbol: '：',
    description: 'manuscript sign/punctuation',
    insert: '：',
  },
  {
    id: 'paren-fullwidth',
    symbol: '（　）',
    description: 'modern/standard equivalent',
    open: '（',
    close: '）',
  },
  {
    id: 'angle',
    symbol: '〈　〉',
    description: 'correction of an erroneous character',
    open: '〈',
    close: '〉',
  },
  { id: 'square-ascii', symbol: '[　]', description: 'supplied reading', open: '[', close: ']' },
  {
    id: 'square-fullwidth',
    symbol: '［　］',
    description: 'supplied reading (fullwidth)',
    open: '［',
    close: '］',
  },
  {
    id: 'lenticular-black',
    symbol: '【　】',
    description: 'reconstructed/supplied text',
    open: '【',
    close: '】',
  },
  {
    id: 'lenticular-white',
    symbol: '〖　〗',
    description: 'supplied omission (脫文)',
    open: '〖',
    close: '〗',
  },
  {
    id: 'brace-ascii',
    symbol: '{　}',
    description: 'superfluous text (衍文)',
    open: '{',
    close: '}',
  },
  {
    id: 'brace-fullwidth',
    symbol: '｛　｝',
    description: 'superfluous text (衍文, fullwidth)',
    open: '｛',
    close: '｝',
  },
  { id: 'ligature', symbol: '⌎　⌏', description: '合文 delimiters', open: '⌎', close: '⌏' },
];

export const insertAtCursor = (writer: Writer, text: string) => {
  const editor = writer.editor;
  if (!editor) return;
  editor.selection.setContent(text);
  editor.focus();
  writer.event('contentChanged').publish();
};

/** Wraps the current selection in `open`/`close`; with nothing selected,
 * inserts both halves and leaves the cursor between them. */
export const insertBracketPair = (writer: Writer, open: string, close: string) => {
  const editor = writer.editor;
  if (!editor) return;

  const selectedText = editor.selection.getContent({ format: 'text' });
  editor.selection.setContent(`${open}${selectedText}${close}`);

  if (!selectedText) {
    const rng = editor.selection.getRng();
    const container = rng.startContainer;
    if (container.nodeType === Node.TEXT_NODE && rng.startOffset >= close.length) {
      const caretOffset = rng.startOffset - close.length;
      rng.setStart(container, caretOffset);
      rng.setEnd(container, caretOffset);
      editor.selection.setRng(rng);
    }
  }

  editor.focus();
  writer.event('contentChanged').publish();
};
