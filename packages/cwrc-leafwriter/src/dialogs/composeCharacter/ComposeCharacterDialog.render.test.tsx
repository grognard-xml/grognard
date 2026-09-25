import { fireEvent, screen } from '@testing-library/react';
import type Writer from '../../js/Writer';
import { ComposeCharacterDialog } from './ComposeCharacterDialog';
import { renderWithOvermind } from '../../../test/renderWithOvermind';

/**
 * Render smoke test for the glyph composer dialog. Mounting exercises every
 * hook, which catches render-time bugs `tsc` can't. Phase C replaced the
 * dropdown and stacked fields with a layout palette and a square, so these
 * checks follow that interaction: a palette click changes the selected
 * region, and focusing a field makes the next click nest inside it.
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

const pickLayout = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('ComposeCharacterDialog', () => {
  it('mounts without throwing', () => {
    expect(() =>
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />),
    ).not.toThrow();
  });

  it('shows a left/right square and a draft IDS string', () => {
    renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

    expect(screen.getByRole('group', { name: 'Composition' })).toBeTruthy();
    expect(screen.getByLabelText('Left')).toBeTruthy();
    expect(screen.getByLabelText('Right')).toBeTruthy();
    expect(screen.getByText('⿰??')).toBeTruthy();
  });

  it('adds a third box when the outer layout is the three-part left/middle/right', () => {
    renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

    pickLayout(/left \/ middle \/ right/i);

    expect(screen.getByLabelText('Left')).toBeTruthy();
    expect(screen.getByLabelText('Middle')).toBeTruthy();
    expect(screen.getByLabelText('Right')).toBeTruthy();
    expect(screen.getByText('⿲???')).toBeTruthy();
  });

  it('nests a layout inside the field that is focused', () => {
    renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

    fireEvent.focus(screen.getByLabelText('Right'));
    pickLayout(/above \/ below/i);

    expect(screen.getByLabelText('Left')).toBeTruthy();
    expect(screen.getByLabelText('Above')).toBeTruthy();
    expect(screen.getByLabelText('Below')).toBeTruthy();
    expect(screen.queryByLabelText('Right')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove this layout' })).toBeTruthy();
    expect(screen.getByText('⿰?⿱??')).toBeTruthy();
  });

  it('changes the inner layout when that region, not a field, is selected', () => {
    renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

    fireEvent.focus(screen.getByLabelText('Right'));
    pickLayout(/above \/ below/i);
    fireEvent.click(screen.getByRole('group', { name: /above \/ below layout/i }));
    pickLayout(/full enclosure/i);

    expect(screen.getByLabelText('Left')).toBeTruthy();
    expect(screen.getByLabelText('Surround')).toBeTruthy();
    expect(screen.getByLabelText('Inside')).toBeTruthy();
    expect(screen.queryByLabelText('Above')).toBeNull();
  });

  it('returns palette clicks to the outer square when the square is clicked', () => {
    renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

    fireEvent.focus(screen.getByLabelText('Right'));
    fireEvent.click(screen.getByRole('group', { name: 'Composition' }));
    pickLayout(/above \/ below/i);

    expect(screen.getByLabelText('Above')).toBeTruthy();
    expect(screen.getByLabelText('Below')).toBeTruthy();
    expect(screen.queryByLabelText('Left')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove this layout' })).toBeNull();
  });
});
