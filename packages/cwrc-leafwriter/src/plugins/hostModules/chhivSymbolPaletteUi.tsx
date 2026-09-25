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

/** Opens the component-based glyph composer (Phase 1: see
 * plugins/glyph_maker.md). Stays open after a successful insert, the same
 * "keep composing/inserting without reopening" interaction as the other two
 * CHHIV dialogs.
 *
 * Dynamically imported here rather than statically at the top of this file:
 * the composer's dependency graph pulls in the bundled GlyphWiki KAGE core
 * (~17 MB JSON, see kageRenderer.ts) - a static import dragged that into
 * this module's own chunk and produced a genuine "cannot access before
 * initialization" TDZ error on the menu click (the toolbar registers and
 * becomes clickable before that chunk finishes loading/executing). Every
 * other heavy host module in this plugin system is already loaded this way
 * (see plugins/hostModules/index.ts's HOST_MODULE_LOADERS) - this just
 * applies the same pattern one level down, to the composer specifically
 * rather than the whole CHHIV module (whose other two dialogs stay cheap to
 * load eagerly). */
const openComposeCharacter = async (writer: Writer) => {
  const { ComposeCharacterDialog } =
    await import('../../dialogs/composeCharacter/ComposeCharacterDialog');
  writer.overmindActions?.ui?.openDialog({
    type: 'simple',
    props: {
      maxWidth: 'md',
      title: 'Compose character',
      Body: () => <ComposeCharacterDialog writer={writer} />,
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
      {
        id: 'compose-character',
        label: 'Compose character…',
        onClick: () => {
          const writer = window.writer;
          if (!writer) return;
          void openComposeCharacter(writer);
        },
      },
    ],
  });
}
