import type {
  Target as PossibleNodesAtTarget,
  ValidationResponse,
  ValidatorType,
} from '@cwrc/leafwriter-validator';
import { WorkingState } from '@cwrc/salve-dom-leafwriter';
import * as Comlink from 'comlink';
import { Context } from '../';
import Writer from '../../js/Writer';
import { debugValidator } from './debugValidator';
import { devValidatorWorkerUrl } from './devWorkerUrl';
import { checkWellFormedness } from '../../utilities/checkWellFormedness';
import {
  fetchResourceText,
  isLocalFileUrl,
  clearLocalSchemaBlobCache,
} from '../../utilities/fetchResource';

const getValidatorInstrumentation = () => {
  if (!window.__desktopValidatorInstrumentation) {
    window.__desktopValidatorInstrumentation = {
      workerLoading: false,
      workerLoaded: false,
      schemaLoading: false,
      schemaLoaded: false,
      validationRunning: false,
      validationPanelRequested: false,
      validationPanelMounted: false,
    };
  }
  return window.__desktopValidatorInstrumentation;
};

const logValidatorInstrumentation = (_tag: string) => undefined;

export type SourceValidationResult = ValidationResponse & {
  parseError?: Extract<ReturnType<typeof checkWellFormedness>, { valid: false }>['error'];
  /** RelaxNG validation did not run (worker or schema unavailable). */
  schemaUnavailable?: boolean;
};

declare global {
  interface Window {
    leafwriterValidator: Comlink.Remote<ValidatorType>;
    writer: Writer;
  }
}

const isEditorSchemaReady = (writer: Writer): boolean => {
  const schemaManager = writer.schemaManager;
  const schemaURL = schemaManager.getRng() ?? schemaManager.getCurrentDocumentSchemaUrl();
  if (!schemaURL) return false;

  const schemaId =
    schemaManager.schemaId ??
    schemaManager.getCurrentSchema()?.id ??
    schemaManager.getSchemaIdFromUrl(schemaURL);

  return Boolean(schemaId);
};

/** Block until the editor knows which RelaxNG schema to compile, or give up after document open. */
const waitForEditorSchema = (writer: Writer): Promise<boolean> => {
  if (isEditorSchemaReady(writer)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      writer.event('schemaLoaded').unsubscribe(onSchemaLoaded);
      writer.event('documentLoaded').unsubscribe(onDocumentLoaded);
      resolve(ready);
    };

    const onSchemaLoaded = () => finish(isEditorSchemaReady(writer));

    const onDocumentLoaded = (success?: boolean) => {
      if (success === false) {
        finish(false);
        return;
      }
      // Document finished opening; schemaLoaded may still be in flight this tick.
      queueMicrotask(() => finish(isEditorSchemaReady(writer)));
    };

    writer.event('schemaLoaded').subscribe(onSchemaLoaded);
    writer.event('documentLoaded').subscribe(onDocumentLoaded);

    if (writer.isDocLoaded) {
      queueMicrotask(() => finish(isEditorSchemaReady(writer)));
    }
  });
};

let validatorSpawnInFlight: Promise<void> | null = null;

export interface LoadValidatorOptions {
  silent?: boolean;
  /** When false, the caller guarantees the editor schema is already resolved (e.g. loadSchema). */
  waitForSchema?: boolean;
}

export const loadValidator = async (
  { state, actions }: Context,
  options?: LoadValidatorOptions,
) => {
  const instrumentation = getValidatorInstrumentation();
  const writer = window.writer;

  if (!writer) {
    logValidatorInstrumentation('loadValidator aborted: no writer');
    return;
  }

  // Worker already running — just ensure the current schema is loaded into it.
  if (state.validator.hasWorkerValidator && window.leafwriterValidator) {
    await actions.validator.initialize(options);
    return;
  }

  const shouldWaitForSchema = options?.waitForSchema !== false;

  if (shouldWaitForSchema) {
    const schemaReady = await waitForEditorSchema(writer);
    if (!schemaReady) {
      state.validator.hasSchema = false;
      logValidatorInstrumentation('loadValidator deferred: schema not ready');
      return;
    }
  } else if (!isEditorSchemaReady(writer)) {
    state.validator.hasSchema = false;
    logValidatorInstrumentation('loadValidator aborted: schema not ready (no wait)');
    return;
  }

  if (validatorSpawnInFlight) {
    await validatorSpawnInFlight;
    await actions.validator.initialize(options);
    return;
  }

  instrumentation.workerLoading = true;
  instrumentation.workerLoaded = false;
  logValidatorInstrumentation('loadValidator started');

  validatorSpawnInFlight = (async () => {
    const baseUrl = state.editor.baseUrl;
    const validator = await loadWebworker(baseUrl);
    if (!validator) {
      instrumentation.workerLoading = false;
      instrumentation.workerLoaded = false;
      logValidatorInstrumentation('loadValidator failed');
      return;
    }

    window.leafwriterValidator = validator;
    state.validator.hasWorkerValidator = true;
    state.validator.hasSchema = false;
    instrumentation.workerLoading = false;
    instrumentation.workerLoaded = true;
    logValidatorInstrumentation('loadValidator completed');
  })();

  try {
    await validatorSpawnInFlight;
  } finally {
    validatorSpawnInFlight = null;
  }

  if (!state.validator.hasWorkerValidator) {
    return;
  }

  await actions.validator.initialize(options);
};

const loadWebworker = async (baseUrl = ''): Promise<Comlink.Remote<ValidatorType>> => {
  return await new Promise((resolve) => {
    // TODO: Improve the way to load webworkers for dev
    // * Check ThreadsJS once again.
    // * Or maybe experiment with ESBUILD

    // `devValidatorWorkerUrl` lives in its own module so that `import.meta` does
    // not appear here — see that file for why it blocks every test importing
    // this package's overmind, and why the WORKER_ENV guard has to live inside
    // it rather than out here. It returns null outside development.
    const devUrl = devValidatorWorkerUrl();
    const worker = devUrl
      ? new Worker(devUrl)
      : new Worker(`${baseUrl}/leafwriter-validator.worker.js`);

    const validator: Comlink.Remote<ValidatorType> = Comlink.wrap(worker);

    resolve(validator);
  });
};

const resolveSchemaForWorker = async (
  schemaURL: string,
): Promise<{ url: string; schemaText?: string } | null> => {
  if (isLocalFileUrl(schemaURL)) {
    const schemaText = await fetchResourceText(schemaURL);
    if (!schemaText) return null;
    // Pass text to the worker; keep grognard URL as the stable identity key.
    return { url: schemaURL, schemaText };
  }
  return { url: schemaURL };
};

export const initialize = async ({ state }: Context, options?: { silent?: boolean }) => {
  const instrumentation = getValidatorInstrumentation();
  instrumentation.schemaLoading = true;
  instrumentation.schemaLoaded = false;
  logValidatorInstrumentation('initialize started');

  const writer = window.writer;
  if (!writer) {
    instrumentation.schemaLoading = false;
    logValidatorInstrumentation('initialize aborted: no writer');
    return;
  }

  if (!state.validator.hasWorkerValidator) {
    instrumentation.schemaLoading = false;
    return;
  }

  const workerValidator = window.leafwriterValidator;
  state.validator.hasWorkerValidator = !!workerValidator;

  const schemaManager = writer.schemaManager;
  const documentSchemaUrl = schemaManager.getCurrentDocumentSchemaUrl();
  const schemaURL = schemaManager.getRng() ?? documentSchemaUrl;
  const schemaId =
    schemaManager.schemaId ??
    schemaManager.getCurrentSchema()?.id ??
    (schemaURL ? schemaManager.getSchemaIdFromUrl(schemaURL) : undefined);

  if (!schemaId || !schemaURL) {
    state.validator.hasSchema = false;
    instrumentation.schemaLoading = false;
    logValidatorInstrumentation('initialize aborted: no schema id or url');
    return;
  }

  const schemaRevision = schemaManager.getSchemaRevision();
  const resolved = await resolveSchemaForWorker(schemaURL);
  if (!resolved) {
    state.validator.hasSchema = false;
    instrumentation.schemaLoading = false;
    console.warn('[validator] could not read local schema for RelaxNG validation:', schemaURL);
    logValidatorInstrumentation('initialize failed: could not read local schema');
    return;
  }

  const shouldCache = !isLocalFileUrl(schemaURL);
  let schemaWorker: { success: boolean; error?: Error };
  try {
    schemaWorker = await workerValidator.initialize({
      id: schemaId,
      url: resolved.url,
      schemaRevision,
      schemaText: resolved.schemaText,
      shouldCache,
    });
  } catch (error) {
    schemaWorker = {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
    console.warn('[validator] worker schema initialize threw:', error);
  }

  instrumentation.schemaLoading = false;
  instrumentation.schemaLoaded = !!schemaWorker.success;
  if (!schemaWorker.success) {
    console.warn(
      '[validator] RelaxNG schema failed to compile in worker:',
      schemaId,
      resolved.url,
      schemaRevision ?? '',
      schemaWorker.error?.message ?? '(no error message)',
    );
  }
  logValidatorInstrumentation(schemaWorker.success ? 'initialize completed' : 'initialize failed');

  if (schemaWorker.success) {
    state.validator.hasSchema = true;
  } else {
    state.validator.hasSchema = false;
  }

  // Callers that already trigger their own validate() afterward (like
  // validate() itself, below) must suppress this event: the validation
  // panel's "workerValidatorLoaded" subscriber calls validate() on receipt,
  // which would call initialize() again, publish again, and loop forever.
  if (!options?.silent) {
    window.writer?.event('workerValidatorLoaded').publish(schemaWorker);
  }
};

declare global {
  interface Window {
    /** True while an automatic validation publishes its result: the validation panel must not
     * open for it. Set by `validate` below, read by the validation panel. */
    __lwQuietValidation?: boolean;
  }
}

/**
 * Tell the validation panel whether this result is allowed to open it. Automatic runs (while
 * typing in Source mode, or the check made when saving) are `quiet`: the panel stays as it is and
 * the result still reaches the markers and the status bar. Only an explicit Validate reveals it.
 */
const publishValidated = (
  writer: NonNullable<typeof window.writer>,
  quiet: boolean,
  ...args: Parameters<ReturnType<NonNullable<typeof window.writer>['event']>['publish']>
) => {
  window.__lwQuietValidation = quiet;
  try {
    writer.event('documentValidated').publish(...args);
  } finally {
    window.__lwQuietValidation = false;
  }
};

export const validate = async ({ state, actions }: Context, options?: { quiet?: boolean }) => {
  const quiet = options?.quiet === true;
  const instrumentation = getValidatorInstrumentation();
  instrumentation.validationRunning = true;

  const writer = window.writer;
  if (!writer) {
    instrumentation.validationRunning = false;
    return;
  }

  // Ensure the worker exists and holds the current schema before validating.
  await actions.validator.loadValidator({ silent: true });

  let documentString: string | null | undefined;
  try {
    documentString =
      state.ui.editorViewMode === 'source'
        ? state.ui.sourceCurrentContent
        : await writer.converter.getDocumentContent(false);
  } catch {
    // No convertible content (e.g. editor mid-teardown or schema root not
    // resolved yet) — nothing meaningful to validate.
    instrumentation.validationRunning = false;
    return;
  }

  // Visual mode often edits a body-only tree; reattach the stored teiHeader so
  // RelaxNG sees the on-disk document. Source mode shows the full XML buffer —
  // validate that as-is so header edits (sourceDesc, etc.) are not silently
  // overwritten by a stale stored snapshot.
  const mergeForValidation = window.__desktopMergeHeaderForValidation;
  const validationString =
    state.ui.editorViewMode === 'source'
      ? documentString
      : typeof mergeForValidation === 'function'
        ? mergeForValidation(documentString ?? '')
        : documentString;

  if (!validationString) {
    instrumentation.validationRunning = false;
    return;
  }

  const wellFormed = checkWellFormedness(validationString);
  if (!wellFormed.valid) {
    const parseErrorCount = wellFormed.error.positions?.length ?? 1;
    await actions.validator.updateValidationError(parseErrorCount);
    publishValidated(
      writer,
      quiet,
      false,
      {
        state: WorkingState.INVALID,
        valid: false,
        errors: [],
        parseError: wellFormed.error,
      } satisfies SourceValidationResult,
      validationString,
    );
    instrumentation.validationRunning = false;
    return;
  }

  if (!state.validator.hasWorkerValidator || !state.validator.hasSchema) {
    await actions.validator.updateValidationError(1);
    publishValidated(
      writer,
      quiet,
      false,
      {
        state: WorkingState.INVALID,
        valid: false,
        errors: [],
        schemaUnavailable: true,
      } satisfies SourceValidationResult,
      validationString,
    );
    instrumentation.validationRunning = false;
    logValidatorInstrumentation('validate skipped: no worker or schema');
    return;
  }

  const workerValidator = window.leafwriterValidator;

  const validationProgress = async ({ partDone, state, valid, errors }: ValidationResponse) => {
    if (state.valueOf() <= 2) {
      writer.event('documentValidating').publish(partDone);
      return;
    }

    const totalError = valid ? 0 : (errors?.length ?? 0);
    await actions.validator.updateValidationError(totalError);

    publishValidated(writer, quiet, valid, { valid, errors }, validationString);
  };

  await workerValidator.validate(validationString, Comlink.proxy(validationProgress));
  instrumentation.validationRunning = false;
};

export const updateValidationError = async ({ state }: Context, value: number) => {
  state.validator.validationErrors = value;
};

type GetAtAction =
  'AttributeAt' | 'AttributesForTagAt' | 'NodesForTagAt' | 'TagAt' | 'ValuesForTagAttributeAt';

export const getAt = async (
  { actions }: Context,
  {
    action,
    attributeName,
    index,
    parentXpath,
    tagName,
    xpath,
  }: {
    action: GetAtAction;
    attributeName?: string;
    index?: number;
    parentXpath?: string;
    tagName?: string;
    xpath?: string;
  },
) => {
  const {
    getTagAt,
    getNodesForTagAt,
    getAttributesForTagAt,
    getTagAttributeAt,
    getValuesForTagAttributeAt,
  } = actions.validator;

  switch (action) {
    case 'TagAt':
      if (!tagName || !parentXpath) return;
      return await getTagAt({ tagName, parentXpath, index });

    case 'NodesForTagAt':
      if (!xpath) return;
      return await getNodesForTagAt({ xpath, index });

    case 'AttributesForTagAt':
      if (!xpath) return;
      return await getAttributesForTagAt({ xpath, index });

    case 'AttributeAt':
      if (!attributeName || !parentXpath) return;
      return await getTagAttributeAt({ attributeName, parentXpath });

    case 'ValuesForTagAttributeAt':
      if (!xpath) return;
      return await getValuesForTagAttributeAt({ xpath });

    default:
      return;
  }
};

export const getTagAt = async (
  { state }: Context,
  { tagName, parentXpath, index }: { tagName: string; parentXpath: string; index?: number },
) => {
  if (!state.validator.hasWorkerValidator) return;
  const workerValidator = window.leafwriterValidator;

  const tag = await workerValidator.getTagAt(tagName, parentXpath, index);
  return tag;
};

export const getNodesForTagAt = async (
  { state }: Context,
  { xpath, index }: { xpath: string; index?: number },
) => {
  if (!state.validator.hasWorkerValidator) return;
  const workerValidator = window.leafwriterValidator;

  const tags = await workerValidator.getNodesForTagAt(xpath, index);
  return tags;
};

export const getAttributesForTagAt = async (
  { state }: Context,
  { xpath, index }: { xpath: string; index?: number },
) => {
  if (!state.validator.hasWorkerValidator) return;
  const workerValidator = window.leafwriterValidator;

  const attributes = await workerValidator.getAttributesForTagAt(xpath, index);
  return attributes;
};

export const getTagAttributeAt = async (
  { state }: Context,
  { attributeName, parentXpath }: { attributeName: string; parentXpath: string },
) => {
  if (!state.validator.hasWorkerValidator) return;
  const workerValidator = window.leafwriterValidator;

  const attribute = await workerValidator.getTagAttributeAt(attributeName, parentXpath);
  return attribute;
};

export const getValuesForTagAttributeAt = async (
  { state }: Context,
  { xpath }: { xpath: string },
) => {
  if (!state.validator.hasWorkerValidator) return;
  const workerValidator = window.leafwriterValidator;

  const values = await workerValidator.getValuesForTagAttributeAt(xpath);
  return values;
};

export const getPossibleNodesAt = async ({ state }: Context, params: PossibleNodesAtTarget) => {
  if (!state.validator.hasWorkerValidator) return;
  const workerValidator = window.leafwriterValidator;

  const response = await workerValidator.getPossibleNodesAt(params, { speculativeValidate: true });

  //? filter text nodes until we have a beter support for it
  const nodes = response?.nodes.filter((node) => node.type !== 'text');
  return nodes;
};

export const clear = ({ state }: Context) => {
  state.validator.hasSchema = false;
  state.validator.hasWorkerValidator = false;
};

export const clearCache = async (_props: Context) => {
  clearLocalSchemaBlobCache();
  if (!window.leafwriterValidator) return;
  await window.leafwriterValidator.clearCache();
};

export const debugValidatorState = async (_props: Context, options?: { runValidation?: boolean }) =>
  debugValidator(options);
