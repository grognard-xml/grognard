import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useAppState } from '@src/overmind';
import { SidebarFindTab } from './SidebarFindTab';
import { searchText } from '../find/searchText';

/**
 * Render smoke test for the find/replace sidebar. See
 * SidebarDatabaseTab.render.test.tsx for why these exist.
 */

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('../find/searchText', () => ({
  searchText: jest.fn(async () => ({ results: [], totalMatches: 0, error: null })),
}));

jest.mock('@src/overmind', () => {
  const m = jest.requireActual('../../../test/mocks/overmind');
  const state = m.appState();
  const acts = m.actions();
  return { useAppState: () => state, useActions: () => acts };
});

// Reached through useFindReplace -> useLeafWriter, which calls useNavigate.
const renderPanel = () =>
  render(
    <MemoryRouter>
      <SidebarFindTab />
    </MemoryRouter>,
  );

describe('SidebarFindTab', () => {
  it('mounts with no project open', () => {
    expect(() => renderPanel()).not.toThrow();
  });

  it('offers a find field', () => {
    renderPanel();
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });

  describe('saving a document', () => {
    it('re-runs the search so results do not point at stale locations', async () => {
      const tab = (dirty: boolean) => ({
        filePath: '/p/a.xml',
        content: '<TEI/>',
        lastSavedContent: '<TEI/>',
        dirty,
      });
      const project = useAppState().project as unknown as { openTabs: unknown[] };
      project.openTabs = [tab(false)];
      const search = searchText as jest.Mock;
      search.mockResolvedValue({
        results: [
          {
            filePath: '/p/a.xml',
            matches: [{ start: 0, end: 1, line: 1, column: 1, snippet: 'x' }],
          },
        ],
        totalMatches: 1,
        error: null,
      });

      const { rerender } = renderPanel();
      const find = screen.getByLabelText('LWC.desktop.sidebar.find.find_label');
      fireEvent.change(find, { target: { value: 'x' } });
      fireEvent.keyDown(find, { key: 'Enter' });
      await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(document.body.textContent).toContain('1 match in 1 file'));

      // A fresh element each time: re-rendering the very same element is skipped by React.
      const panel = () => (
        <MemoryRouter>
          <SidebarFindTab />
        </MemoryRouter>
      );
      project.openTabs = [tab(true)];
      rerender(panel());
      expect(search).toHaveBeenCalledTimes(1); // an edit alone does not re-search

      project.openTabs = [tab(false)];
      rerender(panel());
      await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    });
  });

  describe('search history', () => {
    const seed = () =>
      localStorage.setItem(
        'grognard:searchHistory:find',
        JSON.stringify([
          {
            query: '郭璞',
            replace: 'Guo Pu',
            ignoreCase: false,
            useRegex: true,
            scope: 'project',
            docScope: 'both',
            customPath: '',
          },
          {
            query: '景純',
            ignoreCase: true,
            useRegex: false,
            scope: 'currentFile',
            docScope: 'both',
            customPath: '',
          },
        ]),
      );

    const openHistory = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Search history' }));

    beforeEach(() => {
      localStorage.clear();
      jest.clearAllMocks();
    });

    it('remembers a search that was run, with the replacement typed beside it', async () => {
      renderPanel();
      const find = screen.getByLabelText('LWC.desktop.sidebar.find.find_label');
      fireEvent.change(find, { target: { value: '郭璞' } });
      fireEvent.change(screen.getByLabelText('LWC.desktop.sidebar.find.replace_label'), {
        target: { value: 'Guo Pu' },
      });
      fireEvent.keyDown(find, { key: 'Enter' });

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('grognard:searchHistory:find') ?? '[]');
        expect(stored[0]).toMatchObject({ query: '郭璞', replace: 'Guo Pu', useRegex: false });
      });
    });

    it('lists earlier searches with their replacement and options', () => {
      seed();
      renderPanel();
      openHistory();

      const menu = screen.getByRole('menu');
      expect(within(menu).getByText('郭璞')).toBeTruthy();
      expect(within(menu).getByText(/Guo Pu/)).toBeTruthy();
      expect(within(menu).getByText('.*')).toBeTruthy();
      expect(within(menu).getByText('Aa')).toBeTruthy();
    });

    it('says so when there is nothing to show', () => {
      renderPanel();
      openHistory();
      expect(screen.getByText('No earlier searches')).toBeTruthy();
    });

    it('restores the find, its replacement and its options, and runs nothing', () => {
      seed();
      renderPanel();
      openHistory();
      fireEvent.click(within(screen.getByRole('menu')).getByText('郭璞'));

      expect(
        (screen.getByLabelText('LWC.desktop.sidebar.find.find_label') as HTMLInputElement).value,
      ).toBe('郭璞');
      expect(
        (screen.getByLabelText('LWC.desktop.sidebar.find.replace_label') as HTMLInputElement).value,
      ).toBe('Guo Pu');
      expect(
        screen.getByLabelText('LWC.desktop.sidebar.find.use_regex').getAttribute('aria-pressed'),
      ).toBe('true');
      expect(searchText).not.toHaveBeenCalled();
    });

    it('clears the replacement when the chosen entry had none', () => {
      seed();
      renderPanel();
      const replace = screen.getByLabelText(
        'LWC.desktop.sidebar.find.replace_label',
      ) as HTMLInputElement;
      fireEvent.change(replace, { target: { value: 'left over' } });

      openHistory();
      fireEvent.click(within(screen.getByRole('menu')).getByText('景純'));

      expect(replace.value).toBe('');
      expect(searchText).not.toHaveBeenCalled();
    });

    it('removes one entry, and clears them all', () => {
      seed();
      renderPanel();
      openHistory();
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove from history' })[0]!);
      expect(JSON.parse(localStorage.getItem('grognard:searchHistory:find') ?? '[]')).toHaveLength(
        1,
      );

      // The menu stays open after removing one, so the rest can be cleared from it.
      fireEvent.click(screen.getByText('Clear history'));
      expect(JSON.parse(localStorage.getItem('grognard:searchHistory:find') ?? '[]')).toEqual([]);
    });
  });
});
