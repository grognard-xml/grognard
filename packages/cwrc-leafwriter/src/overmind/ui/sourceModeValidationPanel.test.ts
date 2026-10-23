import { guardSourceModeSave } from './actions';

const VALID = '<TEI><text><body><p>x</p></body></text></TEI>';
const NOT_WELL_FORMED = '<TEI><text><body><p>x</body></text></TEI>';

const setup = (over: { content: string; schema?: boolean; validationErrors?: number }) => {
  const showModule = jest.fn();
  (window as unknown as { writer: unknown }).writer = {
    layoutManager: { showModule },
    event: () => ({ publish: jest.fn() }),
  };
  const state = {
    ui: {
      editorViewMode: 'source',
      sourceCurrentContent: over.content,
      sourceOriginalContent: over.content,
    },
    editor: { allowSourceModeSchemaViolations: false },
    validator: {
      hasWorkerValidator: over.schema === true,
      hasSchema: over.schema === true,
      validationErrors: over.validationErrors ?? 0,
    },
  };
  const actions = {
    validator: { validate: jest.fn(async () => undefined), updateValidationError: jest.fn() },
    ui: {
      // The user closes the "invalid document" dialog with Cancel.
      openDialog: jest.fn((dialog: { props: { onClose: (action: string) => void } }) =>
        dialog.props.onClose('cancel'),
      ),
    },
  };
  return { state, actions, showModule };
};

const run = (ctx: ReturnType<typeof setup>) =>
  guardSourceModeSave({ state: ctx.state, actions: ctx.actions } as never);

afterEach(() => {
  delete (window as unknown as { writer?: unknown }).writer;
});

describe('the validation panel and saving in Source mode', () => {
  it('stays closed when the buffer is valid, and the check is quiet', async () => {
    const ctx = setup({ content: VALID, schema: true, validationErrors: 0 });

    const result = await run(ctx);

    expect(result.proceed).toBe(true);
    expect(ctx.actions.validator.validate).toHaveBeenCalledWith({ quiet: true });
    expect(ctx.showModule).not.toHaveBeenCalled();
  });

  it('stays closed when there is no schema to check against', async () => {
    const ctx = setup({ content: VALID, schema: false });

    const result = await run(ctx);

    expect(result.proceed).toBe(true);
    expect(ctx.showModule).not.toHaveBeenCalled();
  });

  it('opens when the buffer is not well formed, since the save is blocked', async () => {
    const ctx = setup({ content: NOT_WELL_FORMED });

    const result = await run(ctx);

    expect(result.proceed).toBe(false);
    expect(ctx.showModule).toHaveBeenCalledWith('validation');
  });

  it('opens when the schema blocks the save, since the dialog sends you there', async () => {
    const ctx = setup({ content: VALID, schema: true, validationErrors: 3 });

    const result = await run(ctx);

    expect(result.proceed).toBe(false);
    expect(ctx.showModule).toHaveBeenCalledWith('validation');
  });
});
