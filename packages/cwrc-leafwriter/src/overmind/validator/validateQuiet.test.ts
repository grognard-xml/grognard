import { validate } from './actions';

/** What the panel sees as each result is published: whether this run may open it. */
const setup = () => {
  const seen: { valid: boolean; quiet: boolean | undefined }[] = [];
  (window as unknown as { writer: unknown }).writer = {
    converter: { getDocumentContent: async () => null },
    event: () => ({
      publish: (valid: boolean) => seen.push({ valid, quiet: window.__lwQuietValidation }),
    }),
  };
  const state = {
    ui: { editorViewMode: 'source', sourceCurrentContent: '<TEI><p>x</TEI>' },
    validator: { hasWorkerValidator: false, hasSchema: false },
  };
  const actions = {
    validator: { loadValidator: jest.fn(async () => undefined), updateValidationError: jest.fn() },
  };
  return { seen, state, actions };
};

const run = (ctx: ReturnType<typeof setup>, options?: { quiet?: boolean }) =>
  validate({ state: ctx.state, actions: ctx.actions } as never, options);

afterEach(() => {
  delete (window as unknown as { writer?: unknown }).writer;
  window.__lwQuietValidation = undefined;
});

describe('validate and the validation panel', () => {
  it('lets an explicit validation open the panel', async () => {
    const ctx = setup();
    await run(ctx);
    expect(ctx.seen).toEqual([{ valid: false, quiet: false }]);
  });

  it('marks an automatic validation as quiet while its result is published', async () => {
    const ctx = setup();
    await run(ctx, { quiet: true });
    expect(ctx.seen).toEqual([{ valid: false, quiet: true }]);
  });

  it('does not leave the quiet flag set for the next validation', async () => {
    const ctx = setup();
    await run(ctx, { quiet: true });
    expect(window.__lwQuietValidation).toBe(false);
    await run(ctx);
    expect(ctx.seen[1]).toEqual({ valid: false, quiet: false });
  });
});
