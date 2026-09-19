import type Writer from '../../js/Writer';
import type { PluginRegisterContext } from '../registerContext';
import { ChhivGlyphPaletteDialog } from '../../dialogs/chhivGlyphPalette/ChhivGlyphPaletteDialog';
import { scanGlyphOccurrences } from '../../utilities/glyphPalette';

/**
 * The palaeography symbol inventory from plugins/paleo-clever-idea.md:
 * single insertable marks, plus bracket-style pairs that wrap the current
 * selection (or insert both halves with the cursor left between them, if
 * nothing is selected). No semantic tagging here - just plain-text insertion.
 */
type ChhivSymbol =
  | { id: string; label: string; insert: string }
  | { id: string; label: string; open: string; close: string };

const CHHIV_SYMBOLS: ChhivSymbol[] = [
  { id: 'illegible', label: '□ illegible character', insert: '□' },
  { id: 'damaged', label: '▨ damaged character', insert: '▨' },
  { id: 'lacuna', label: '〼 lacuna of uncertain extent', insert: '〼' },
  { id: 'ellipsis', label: '…… missing/illegible run', insert: '……' },
  { id: 'uncertain-fullwidth', label: '？ uncertain reading', insert: '？' },
  { id: 'uncertain-ascii', label: '? uncertain reading (ASCII)', insert: '?' },
  { id: 'tentative', label: '* tentative reading', insert: '*' },
  { id: 'repeat-ascii', label: '= repetition/合文 mark', insert: '=' },
  { id: 'repeat-fullwidth', label: '＝ repetition/合文 mark (fullwidth)', insert: '＝' },
  { id: 'repeat-geta', label: '〓 repetition/合文 mark (geta)', insert: '〓' },
  { id: 'ink-dot', label: '· ink dot', insert: '·' },
  { id: 'ink-round', label: '● round ink block', insert: '●' },
  { id: 'ink-square', label: '■ square ink block', insert: '■' },
  { id: 'diagonal-line', label: '/ diagonal manuscript line', insert: '/' },
  { id: 'manuscript-line', label: '— manuscript line/sign', insert: '—' },
  { id: 'manuscript-perp', label: '⊥ manuscript sign', insert: '⊥' },
  { id: 'manuscript-colon', label: '： manuscript sign/punctuation', insert: '：' },
  { id: 'paren-fullwidth', label: '（　） modern/standard equivalent', open: '（', close: '）' },
  { id: 'angle', label: '〈　〉 correction of an erroneous character', open: '〈', close: '〉' },
  { id: 'square-ascii', label: '[　] supplied reading', open: '[', close: ']' },
  { id: 'square-fullwidth', label: '［　］ supplied reading (fullwidth)', open: '［', close: '］' },
  { id: 'lenticular-black', label: '【　】 reconstructed/supplied text', open: '【', close: '】' },
  { id: 'lenticular-white', label: '〖　〗 supplied omission (脫文)', open: '〖', close: '〗' },
  { id: 'brace-ascii', label: '{　} superfluous text (衍文)', open: '{', close: '}' },
  {
    id: 'brace-fullwidth',
    label: '｛　｝ superfluous text (衍文, fullwidth)',
    open: '｛',
    close: '｝',
  },
  { id: 'ligature', label: '⌎　⌏ 合文 delimiters', open: '⌎', close: '⌏' },
];

const insertAtCursor = (writer: Writer, text: string) => {
  const editor = writer.editor;
  if (!editor) return;
  editor.selection.setContent(text);
  editor.focus();
  writer.event('contentChanged').publish();
};

/** Wraps the current selection in `open`/`close`; with nothing selected,
 * inserts both halves and leaves the cursor between them. */
const insertBracketPair = (writer: Writer, open: string, close: string) => {
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

/** Opens the glyph-reuse palette, scanning the document fresh each time so
 * it reflects any glyphs inserted since the dialog was last opened. */
const openGlyphPalette = (writer: Writer) => {
  const occurrences = scanGlyphOccurrences(writer);
  writer.overmindActions?.ui?.openDialog({
    type: 'simple',
    props: {
      maxWidth: 'xs',
      title: 'Insert existing glyph',
      Body: () => <ChhivGlyphPaletteDialog occurrences={occurrences} writer={writer} />,
      actions: [{ action: 'close', label: 'Close' }],
      onClose: () => {},
    },
  });
};

export function registerChhivSymbolPaletteUi(context: PluginRegisterContext): void {
  context.log('registering CHHIV symbol palette');

  context.registerToolbarItem({
    id: 'chhiv-menu',
    icon: 'shortText',
    title: 'CHHIV',
    tooltip: 'Palaeography symbols (CHHIV)',
    group: 'ui',
    isAvailable: () => true,
    menuItems: [
      ...CHHIV_SYMBOLS.map((symbol) => ({
        id: symbol.id,
        label: symbol.label,
        onClick: () => {
          const writer = window.writer;
          if (!writer) return;
          if ('open' in symbol) insertBracketPair(writer, symbol.open, symbol.close);
          else insertAtCursor(writer, symbol.insert);
        },
      })),
      {
        id: 'insert-existing-glyph',
        label: 'Insert existing glyph…',
        onClick: () => {
          const writer = window.writer;
          if (!writer) return;
          openGlyphPalette(writer);
        },
      },
    ],
  });
}
