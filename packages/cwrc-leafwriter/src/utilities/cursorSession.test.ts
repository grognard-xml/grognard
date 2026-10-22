import { placeVisualCaretWhenReady } from './cursorSession';

const buildEditor = () => {
  document.body.innerHTML =
    '<div id="root"><div _tag="TEI"><div _tag="text"><div _tag="body"><div _tag="p">hello world</div></div></div></div></div>';
  const body = document.getElementById('root') as HTMLElement;
  const selected: { node: Node; offset: number }[] = [];
  const focus = jest.fn();
  const editor = {
    getBody: () => body,
    selection: {
      setRng: (range: Range) =>
        selected.push({ node: range.startContainer, offset: range.startOffset }),
    },
    focus,
    currentNode: null as Element | null,
  };
  Element.prototype.scrollIntoView = jest.fn();
  return { editor, selected, focus };
};

type Listener = () => void;

const installWriter = (editor: unknown, mode: 'visual' | 'source') => {
  const listeners = new Set<Listener>();
  const writer = {
    editor,
    overmindState: { ui: { editorViewMode: mode } },
    event: (name: string) => ({
      subscribe: (fn: Listener) => name === 'documentLoaded' && listeners.add(fn),
      unsubscribe: (fn: Listener) => listeners.delete(fn),
      publish: jest.fn(),
    }),
  };
  (window as unknown as { writer: unknown }).writer = writer;
  return { writer, listeners, fireLoaded: () => [...listeners].forEach((fn) => fn()) };
};

describe('placeVisualCaretWhenReady', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    delete (window as unknown as { writer?: unknown }).writer;
  });

  const caret = { teiXPath: '/TEI/text/body/p', offsetInElementText: 6 };

  it('puts the caret at the text offset in the Visual editor', () => {
    const { editor, selected } = buildEditor();
    installWriter(editor, 'visual');

    placeVisualCaretWhenReady(caret);
    jest.advanceTimersByTime(1000);

    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0]?.node.textContent).toBe('hello world');
    expect(selected[0]?.offset).toBe(6);
  });

  it('does nothing while the editor is still in Source mode', () => {
    const { editor, selected } = buildEditor();
    installWriter(editor, 'source');

    placeVisualCaretWhenReady(caret);
    jest.advanceTimersByTime(1000);

    expect(selected).toEqual([]);
  });

  it('after a reload, waits for the document to finish loading', () => {
    const { editor, selected } = buildEditor();
    const { fireLoaded, listeners } = installWriter(editor, 'visual');

    placeVisualCaretWhenReady(caret, { afterReload: true });
    jest.advanceTimersByTime(2000);
    expect(selected).toEqual([]);
    expect(listeners.size).toBe(1);

    fireLoaded();
    jest.advanceTimersByTime(1000);
    expect(selected.length).toBeGreaterThan(0);
    expect(listeners.size).toBe(0);
  });

  it('gives up listening if the reload never reports back', () => {
    const { editor, selected } = buildEditor();
    const { listeners } = installWriter(editor, 'visual');

    placeVisualCaretWhenReady(caret, { afterReload: true });
    jest.advanceTimersByTime(11000);

    expect(listeners.size).toBe(0);
    expect(selected).toEqual([]);
  });

  it('is harmless when the element is not in the editor', () => {
    const { editor, selected } = buildEditor();
    installWriter(editor, 'visual');

    expect(() => {
      placeVisualCaretWhenReady({ teiXPath: '/TEI/text/body/div', offsetInElementText: 0 });
      jest.advanceTimersByTime(1000);
    }).not.toThrow();
    expect(selected).toEqual([]);
  });

  it('finds the element when the editor wraps the root element instead of making it a direct child', () => {
    document.body.innerHTML =
      '<div id="root"><div class="wrapper"><div _tag="TEI"><div _tag="text"><div _tag="body"><div _tag="p">hello world</div></div></div></div></div></div>';
    const selected: { node: Node; offset: number }[] = [];
    const editor = {
      getBody: () => document.getElementById('root') as HTMLElement,
      selection: {
        setRng: (range: Range) =>
          selected.push({ node: range.startContainer, offset: range.startOffset }),
      },
      focus: jest.fn(),
      currentNode: null as Element | null,
    };
    Element.prototype.scrollIntoView = jest.fn();
    installWriter(editor, 'visual');

    placeVisualCaretWhenReady(caret);
    jest.advanceTimersByTime(1000);

    expect(selected[0]?.node.textContent).toBe('hello world');
    expect(selected[0]?.offset).toBe(6);
  });

  it('says why when the caret cannot be placed', () => {
    const { editor } = buildEditor();
    installWriter(editor, 'visual');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    placeVisualCaretWhenReady({ teiXPath: '/TEI/text/body/div', offsetInElementText: 0 });
    jest.advanceTimersByTime(2000);

    expect(warn).toHaveBeenCalledWith(
      '[caret-restore] could not place the Visual caret',
      expect.objectContaining({ elementFound: false, mode: 'visual' }),
    );
    warn.mockRestore();
  });

  it('does not warn when it lands', () => {
    const { editor } = buildEditor();
    installWriter(editor, 'visual');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    placeVisualCaretWhenReady(caret);
    jest.advanceTimersByTime(2000);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
