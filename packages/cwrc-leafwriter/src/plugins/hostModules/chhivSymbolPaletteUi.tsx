import type Writer from '../../js/Writer';
import type { PluginRegisterContext } from '../registerContext';
import { ChhivGlyphPaletteDialog } from '../../dialogs/chhivGlyphPalette/ChhivGlyphPaletteDialog';
import { ChhivSymbolGridDialog } from '../../dialogs/chhivSymbolGrid/ChhivSymbolGridDialog';
import { CHHIV_SYMBOLS } from '../../utilities/chhivSymbols';
import { scanGlyphOccurrences } from '../../utilities/glyphPalette';

/** Opens the symbol grid - a compact picker (see ChhivSymbolGridDialog) that
 * replaces what used to be one menu row per symbol; stays open so several
 * symbols can be inserted in a row without reopening it each time. */
const openSymbolGrid = (writer: Writer) => {
  writer.overmindActions?.ui?.openDialog({
    type: 'simple',
    props: {
      maxWidth: 'xs',
      title: 'CHHIV symbols',
      Body: () => <ChhivSymbolGridDialog symbols={CHHIV_SYMBOLS} writer={writer} />,
      actions: [{ action: 'close', label: 'Close' }],
      onClose: () => {},
    },
  });
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
    icon: 'chhiv',
    title: 'CHHIV',
    tooltip: 'Palaeography symbols (CHHIV)',
    group: 'ui',
    isAvailable: () => true,
    menuItems: [
      {
        id: 'chhiv-symbols',
        label: 'Symbols…',
        onClick: () => {
          const writer = window.writer;
          if (!writer) return;
          openSymbolGrid(writer);
        },
      },
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
