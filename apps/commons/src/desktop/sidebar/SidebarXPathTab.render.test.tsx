import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SidebarXPathTab } from './SidebarXPathTab';
import { searchXPath } from '../xpath/searchXPath';

/**
 * Render smoke test for the XPath sidebar. See SidebarDatabaseTab.render.test.tsx
 * for why these exist: mounting a panel executes every hook body and dependency
 * array, which is the only thing that catches a dependency naming a binding
 * declared further down the component.
 */

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('../xpath/searchXPath', () => ({
  searchXPath: jest.fn(async () => ({ results: [], error: null })),
}));

jest.mock('@src/overmind', () => {
  const m = jest.requireActual('../../../test/mocks/overmind');
  const state = m.appState();
  const acts = m.actions();
  return { useAppState: () => state, useActions: () => acts };
});

describe('SidebarXPathTab', () => {
  it('mounts and offers a query field', () => {
    render(<SidebarXPathTab />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('mounts without a project open', () => {
    expect(() => render(<SidebarXPathTab />)).not.toThrow();
  });

  describe('search history', () => {
    const KEY = 'grognard:searchHistory:xpath';

    beforeEach(() => {
      localStorage.clear();
      jest.clearAllMocks();
    });

    it('remembers a search that was run', async () => {
      render(<SidebarXPathTab />);
      const field = screen.getByRole('textbox');
      fireEvent.change(field, { target: { value: '//persName[@key]' } });
      fireEvent.keyDown(field, { key: 'Enter' });

      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')[0]?.query).toBe('//persName[@key]'),
      );
    });

    it('restores an earlier query and scope without running it', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify([{ query: '//note[@type="comm"]', scope: 'project', customPath: '' }]),
      );
      render(<SidebarXPathTab />);
      fireEvent.click(screen.getByRole('button', { name: 'Search history' }));
      fireEvent.click(within(screen.getByRole('menu')).getByText('//note[@type="comm"]'));

      expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('//note[@type="comm"]');
      expect(searchXPath).not.toHaveBeenCalled();
    });
  });
});
