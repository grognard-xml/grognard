import { enterSourceMode, openDocumentInSourceMode, setEditorViewMode } from './actions';

const setup = () => {
  const state = {
    ui: {
      editorViewMode: 'visual',
      sourceOriginalContent: '',
      sourceCurrentContent: '',
      sourceVisualOutOfSync: false,
      sourcePendingCursorOffset: null,
    },
    editor: { enableXmlEditing: true },
    document: { xml: '<TEI><text><body><p>x</p></body></text></TEI>' },
  };
  const actions = {
    ui: {
      setEditorViewMode: (mode: string) => setEditorViewMode({ state } as never, mode as never),
    },
    document: {
      setLoaded: jest.fn(),
      setDocumentUrl: jest.fn(),
      setDocumentXml: jest.fn(),
    },
  };
  const panels = { left: { collapse: jest.fn() }, right: { collapse: jest.fn() } };
  const w = window as unknown as Record<string, unknown>;
  w.__desktopLeftPanel = panels.left;
  w.__desktopRightPanel = panels.right;
  return { state, actions, panels, context: { state, actions } as never };
};

afterEach(() => {
  const w = window as unknown as Record<string, unknown>;
  delete w.__desktopLeftPanel;
  delete w.__desktopRightPanel;
});

describe('side panels and Source mode', () => {
  it('collapses both panels when the user switches to Source mode', async () => {
    const { context, panels, state } = setup();

    await enterSourceMode(context);

    expect(state.ui.editorViewMode).toBe('source');
    expect(panels.left.collapse).toHaveBeenCalledTimes(1);
    expect(panels.right.collapse).toHaveBeenCalledTimes(1);
  });

  it('leaves the panels alone when a tab is put back in Source mode', async () => {
    const { context, panels, state } = setup();

    await enterSourceMode(context, { restoring: true });

    expect(state.ui.editorViewMode).toBe('source');
    expect(panels.left.collapse).not.toHaveBeenCalled();
    expect(panels.right.collapse).not.toHaveBeenCalled();
  });

  it('leaves the panels alone when a document that opens in Source mode is loaded', () => {
    const { context, panels, state } = setup();

    openDocumentInSourceMode(context, { content: '<TEI/>', filePath: '/p/a.xml' });

    expect(state.ui.editorViewMode).toBe('source');
    expect(panels.left.collapse).not.toHaveBeenCalled();
    expect(panels.right.collapse).not.toHaveBeenCalled();
  });

  it('does not collapse anything just because the mode changed', () => {
    const { panels, state } = setup();

    setEditorViewMode({ state } as never, 'source');

    expect(panels.left.collapse).not.toHaveBeenCalled();
    expect(panels.right.collapse).not.toHaveBeenCalled();
  });

  it('does nothing to the panels when Source mode is already on', async () => {
    const { context, panels, state } = setup();
    state.ui.editorViewMode = 'source';

    await enterSourceMode(context);

    expect(panels.left.collapse).not.toHaveBeenCalled();
  });
});
