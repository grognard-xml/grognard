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

  describe('break apart', () => {
    const breakApart = (char: string) => {
      fireEvent.change(screen.getByLabelText('Break apart a character'), {
        target: { value: char },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Break apart' }));
    };

    it('loads the components of a character into the layout square', () => {
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

      breakApart('謀');

      expect((screen.getByLabelText('Left') as HTMLInputElement).value).toBe('言');
      expect((screen.getByLabelText('Right') as HTMLInputElement).value).toBe('某');
      expect(screen.getByText('⿰言某', { selector: 'p' })).toBeTruthy();
    });

    it('nests where the decomposition nests', () => {
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

      breakApart('万');

      expect((screen.getByLabelText('Above') as HTMLInputElement).value).toBe('一');
      expect(screen.getByRole('group', { name: /left \/ right layout/i })).toBeTruthy();
      expect((screen.getByLabelText('Left') as HTMLInputElement).value).toBe('丿');
    });

    it('leaves the composer alone when the character cannot be broken', () => {
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);
      fireEvent.change(screen.getByLabelText('Left'), { target: { value: '木' } });

      breakApart('一');

      expect(screen.getByText(/can't be broken apart/)).toBeTruthy();
      expect((screen.getByLabelText('Left') as HTMLInputElement).value).toBe('木');
    });

    it('lists every decomposition when there are several and loads the one picked', () => {
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

      breakApart('丟');

      expect(screen.getByRole('button', { name: '⿱王厶' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '⿱一去' }));
      expect((screen.getByLabelText('Above') as HTMLInputElement).value).toBe('一');
      expect((screen.getByLabelText('Below') as HTMLInputElement).value).toBe('去');
    });
  });

  describe('radical forms', () => {
    it('draws a radical in its position form, with a way to keep the typed one', () => {
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

      fireEvent.change(screen.getByLabelText('Left'), { target: { value: '言' } });

      expect(screen.getByText(/drawn as 訁/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'keep 言' }));
      expect(screen.getByText(/full 言/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'use 訁 here' }));
      expect(screen.getByText(/drawn as 訁/)).toBeTruthy();
    });

    it('shows no hint where the radical keeps its own shape', () => {
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);

      fireEvent.change(screen.getByLabelText('Right'), { target: { value: '言' } });

      expect(screen.queryByText(/drawn as/)).toBeNull();
    });

    it('cycles the selected box through the forms of its radical', () => {
      renderWithOvermind(<ComposeCharacterDialog writer={makeFakeWriter()} />);
      const next = screen.getByRole('button', { name: 'Next form' }) as HTMLButtonElement;
      expect(next.disabled).toBe(true);

      const left = screen.getByLabelText('Left') as HTMLInputElement;
      fireEvent.change(left, { target: { value: '言' } });
      fireEvent.focus(left);
      expect(next.disabled).toBe(false);

      fireEvent.click(next);
      expect(left.value).toBe('讠');
      fireEvent.click(next);
      expect(left.value).toBe('⻈');
      fireEvent.click(next);
      expect(left.value).toBe('言');
    });
  });
});
