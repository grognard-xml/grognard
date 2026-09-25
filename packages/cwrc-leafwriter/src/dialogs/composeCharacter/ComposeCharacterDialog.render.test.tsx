import { fireEvent, screen } from '@testing-library/react';
import type Writer from '../../js/Writer';
import { ComposeCharacterDialog } from './ComposeCharacterDialog';
import { renderWithOvermind } from '../../../test/renderWithOvermind';

/**
 * Render smoke test for the glyph composer dialog. See
 * apps/commons/src/desktop/sidebar/SidebarDatabaseTab.render.test.tsx for why
 * these exist - mounting exercises every hook body/dependency array, which
 * catches real render-time bugs `tsc` can't (a stale closure, a
 * temporal-dead-zone reference, a hook called conditionally). This dialog in
 * particular gained a recursive `SlotEditor` in Phase D, exactly the kind of
 * change (a component that renders itself) worth a render-path check for.
 *
 * Deliberately shallow: asserts the dialog mounts, and that clicking "Compose
 * this part" successfully mounts the nested sub-editor too - not that any
 * particular composition behaves correctly (that's projectGlyphStore.test.ts's
 * job, against the real bundled data, without a DOM in the loop at all).
 */
const makeFakeWriter = (): Writer =>
  ({
    editor: {
      selection: {
        getBookmark: () => ({ id: 'bookmark' }),
        setRng: () => {},
        setContent: () => {},
      },
      dom: { createRng: () => ({ setStartAfter: () => {}, collapse: () => {} }) },
      getBody: () => ({}),
      focus: () => {},
    },
    tagger: { ADD: 'ADD', addStructureTag: jest.fn(), processNewContent: () => {} },
    schemaManager: { getCurrentSchema: () => ({ mapping: 'teiAll' }) },
    event: () => ({ publish: jest.fn() }),
    overmindState: { document: { xml: '<TEI/>' } },
    overmindActions: { document: { updateXMLHeader: () => {}, setDocumentXml: () => {} } },
  }) as unknown as Writer;

describe('ComposeCharacterDialog', () => {
  it('mounts without throwing', () => {
    expect(() =>
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />),
    ).not.toThrow();
  });

  it('mounts the nested SlotEditor when "Compose this part" is clicked', () => {
    renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

    const composeButtons = screen.getAllByRole('button', { name: /compose this part/i });
    expect(composeButtons.length).toBeGreaterThan(0);

    expect(() => fireEvent.click(composeButtons[1])).not.toThrow();

    // The second slot is now `nested`, replacing its own leaf field with an
    // operator picker (a <Select>, rendered as a combobox) plus a fresh pair
    // of child fields: "First component" appears twice (the still-leaf top
    // first slot, plus the nested slot's own first child), "Second
    // component" appears once (only the nested slot's second child - the
    // top-level second slot's leaf field is gone, replaced by the nesting).
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByLabelText('First component')).toHaveLength(2);
    expect(screen.getAllByLabelText('Second component')).toHaveLength(1);
  });
});
