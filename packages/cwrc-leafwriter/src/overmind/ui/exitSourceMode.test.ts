import { exitSourceMode } from './actions';
import { placeVisualCaretWhenReady } from '../../utilities/cursorSession';

jest.mock('../../utilities/cursorSession', () => ({
  placeVisualCaretWhenReady: jest.fn(),
}));

const XML = '<TEI><text><body><p>one two</p><p>three four</p></body></text></TEI>';

const setup = (over: {
  current?: string;
  original?: string;
  outOfSync?: boolean;
  cursorOffset?: number | undefined;
}) => {
  const state = {
    ui: {
      sourceCurrentContent: over.current ?? XML,
      sourceOriginalContent: over.original ?? XML,
      sourceVisualOutOfSync: over.outOfSync ?? false,
      editorViewMode: 'source',
    },
    document: { url: null },
    editor: { allowSourceModeSchemaViolations: true },
    validator: { hasWorkerValidator: false, hasSchema: false, validationErrors: 0 },
  };
  const calls: string[] = [];
  const actions = {
    ui: {
      setEditorViewMode: jest.fn(() => calls.push('mode')),
    },
    validator: { validate: jest.fn(async () => undefined), updateValidationError: jest.fn() },
    document: {
      setIsReload: jest.fn(),
      loadDocumentXML: jest.fn(() => calls.push('load')),
    },
  };
  (window as unknown as { __leafWriterSourceFind?: unknown }).__leafWriterSourceFind = {
    getCursorOffset: () => over.cursorOffset,
  };
  return { state, actions, calls };
};

const run = (ctx: ReturnType<typeof setup>) =>
  exitSourceMode({ state: ctx.state, actions: ctx.actions } as never);

describe('exitSourceMode cursor', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    delete (window as unknown as { __leafWriterSourceFind?: unknown }).__leafWriterSourceFind;
  });

  it('carries the Source cursor to the Visual editor when nothing was edited', async () => {
    const ctx = setup({ cursorOffset: XML.indexOf('four') + 2 });

    await expect(run(ctx)).resolves.toBe(true);

    expect(placeVisualCaretWhenReady).toHaveBeenCalledTimes(1);
    expect(placeVisualCaretWhenReady).toHaveBeenCalledWith({
      teiXPath: '/TEI/text/body/p[2]',
      offsetInElementText: 'three '.length + 2,
    });
    expect(ctx.actions.document.loadDocumentXML).not.toHaveBeenCalled();
  });

  it('waits for the reload when the Source edits changed the document, and starts listening first', async () => {
    const edited = XML.replace('three four', 'three four five');
    const ctx = setup({ current: edited, original: XML, cursorOffset: edited.indexOf('five') + 1 });

    await expect(run(ctx)).resolves.toBe(true);

    expect(placeVisualCaretWhenReady).toHaveBeenCalledWith(
      { teiXPath: '/TEI/text/body/p[2]', offsetInElementText: 'three four '.length + 1 },
      { afterReload: true },
    );
    const placeOrder = (placeVisualCaretWhenReady as jest.Mock).mock.invocationCallOrder[0]!;
    const loadOrder = ctx.actions.document.loadDocumentXML.mock.invocationCallOrder[0]!;
    expect(placeOrder).toBeLessThan(loadOrder);
  });

  it('leaves the caret alone when the Source cursor position is unknown', async () => {
    const ctx = setup({ cursorOffset: undefined });

    await expect(run(ctx)).resolves.toBe(true);

    expect(placeVisualCaretWhenReady).not.toHaveBeenCalled();
  });

  it('leaves the caret alone when the cursor is outside the root element', async () => {
    const ctx = setup({ cursorOffset: 0 });

    await run(ctx);

    expect(placeVisualCaretWhenReady).not.toHaveBeenCalled();
  });
});
