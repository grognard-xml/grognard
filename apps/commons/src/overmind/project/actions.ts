import type { Context } from '../';

/** Skip debounced saves while restoring tabs so we do not persist partial/empty session state. */
let suppressWorkspaceSessionSave = false;
import { buildProjectSchemas, type ProjectBundle } from '@src/desktop/projectFile';
import {
  completeProjectOnboarding,
  completePostLoadOnboarding,
} from '@src/desktop/projectOnboarding';
import { ensureEntityDbFolder } from '@src/desktop/entityDbOnboarding';
import { ensureImportHeaderEntitiesForPaths } from '@src/desktop/ensureImportHeaderEntities';
import {
  mergeMetadataIntoHeader,
  metadataFileExists,
  getProjectEncoderName,
  readProjectMetadata,
} from '@src/desktop/projectMetadata';
import { getDefaultSaveAsPath as buildDefaultSaveAsPath } from '@src/desktop/saveAsDefaults';
import {
  getParentPath,
  getPathBasename,
  getProjectSchemaDirPath,
  isPathUnder,
  joinPath,
  removeTreeNode,
  repathFilePath,
  repathTreeSubtree,
  shouldHideExplorerDirectoryEntry,
  updateTreeNode,
} from '@src/desktop/explorer/treeUtils';
import { prepareDesktopDocument } from '@src/desktop/resolveDocumentSchemas';
import { isCorpusExcludedPath } from '@src/desktop/infrastructurePaths';
import { normalizeTeiHeaderLanguageElements } from '@src/desktop/teiHeaderXml';
import { updateTagStatsForFile } from '@src/desktop/tagging/tagStats';
import {
  findCompanionTranslationFiles,
  rewriteCompanionSourceReferences,
} from '@src/desktop/translationCompanionOps';
import { translationFilePathFor } from '@src/desktop/translationFileNaming';
import { reindexTranslationOnSave } from '@src/desktop/translationEntry';
import { clearWriterSession, resetDesktopEditorSession } from '@src/desktop/clearWriterSession';
import { filterVisualCursorPositions } from '../../../../../packages/cwrc-leafwriter/src/utilities/cursorPositionFilter';
import { mergeForkedCentral } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/centralForkMerge';
import {
  isEntityDatabase,
  parseEntities,
  serializeEntities,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import {
  DESKTOP_LEFT_PANEL_EVENT,
  type DesktopLeftPanelShowDetail,
} from '@src/desktop/desktopLeftPanelBridge';
import { registerDesktopSchemas } from '@src/desktop/registerDesktopSchemas';
import { getEnabledCatalogSchemas } from '@src/desktop/schemaCatalog';
import { warmMetadataDialogStateCache } from '@src/desktop/projectMetadataDialogState';
import { maybeCheckSchemaUpdateOnOpen } from '@src/desktop/schemaUpdateCheck';
import { processSaveForAchievements } from '@src/desktop/achievements/engine';
import { stampContentBeforeSave } from '@src/desktop/revisionDescXml';
import { separateBlockElements } from '@src/desktop/xmlBlockSpacing';
import {
  buildDocumentImportPlan,
  buildImportedDocumentXml,
  buildImportedXmlDocument,
  assertImportedXmlWellFormed,
  logImportedXmlInspection,
  type DocumentImportPlanItem,
  type DocumentImportProblem,
  type DocumentImportSource,
} from '@src/desktop/documentImport';
import {
  countImportedParagraphs,
  formatDocumentImportReportDetail,
  summarizeDocumentImportReport,
  type DocumentImportReportEntry,
} from '@src/desktop/documentImportReport';
import { validateImportedXmlRelaxNg } from '@src/desktop/documentImportValidation';
import {
  mergeEditorBodyWithStoredHeader,
  stripTeiHeaderForVisualEditor,
} from '@src/desktop/teiHeaderXml';
import { isDesktop, type WorkspaceCursorPosition } from '@src/types/desktop';
import { buildSkeletonForCatalog } from '@src/desktop/schemaTemplates';
import i18next from 'i18next';
import type { FileTreeNode } from './state';

// * The following line is need for VSC extension i18n ally to work
// useTranslation()
const { t } = i18next;

const getFilename = (filePath: string) => filePath.split(/[/\\]/).pop() ?? filePath;

const replaceExtension = (filePath: string, extension: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const dir = slash === -1 ? '' : normalized.slice(0, slash);
  const name = (slash === -1 ? normalized : normalized.slice(slash + 1)).replace(/\.[^.]+$/, '');
  return joinPath(dir, `${name || 'Untitled'}.${extension.replace(/^\./, '')}`);
};

const isTempDocumentPath = (filePath: string): boolean => /[/\\]grognard[/\\]/.test(filePath);

const isTempTab = (tab: { filePath: string; isTemp?: boolean }) =>
  tab.isTemp || isTempDocumentPath(tab.filePath);

export const deleteTempDocumentAt = async (filePath: string): Promise<void> => {
  if (!isTempDocumentPath(filePath) || !window.electronAPI?.deletePath) return;
  const tempDir = getParentPath(filePath);
  if (!tempDir) return;
  try {
    await window.electronAPI.deletePath(tempDir);
  } catch {
    // temp dir may already be gone
  }
};

export type PromptCloseDirtyTabResult = 'proceed' | 'abort' | 'handled';

export const promptCloseDirtyTab = async (
  context: Context,
  payload: {
    tab: { filePath: string; filename: string; content: string; isTemp?: boolean };
    contentOverride?: string | null;
  },
): Promise<PromptCloseDirtyTabResult> => {
  const { tab, contentOverride } = payload;
  if (!window.electronAPI?.showNativeMessageBox) return 'proceed';

  if (isTempTab(tab)) {
    const response = await window.electronAPI.showNativeMessageBox({
      type: 'warning',
      title: t('LWC.desktop.project.dialogs.unsaved_new_document_title'),
      message: t('LWC.desktop.project.dialogs.save_before_closing', { filename: tab.filename }),
      buttons: [
        t('LWC.desktop.project.dialogs.save_button'),
        t('LWC.desktop.project.dialogs.dont_save_button'),
        t('LWC.desktop.project.dialogs.cancel_button'),
      ],
      cancelId: 2,
      defaultId: 0,
    });

    if (response.response === 2) return 'abort';
    if (response.response === 1) {
      await deleteTempDocumentAt(tab.filePath);
      return 'proceed';
    }

    const guard = await window.writer?.overmindActions?.ui?.guardSourceModeSave?.();
    if (guard && !guard.proceed) {
      if (guard.reverted) {
        context.actions.ui.notifyViaSnackbar(
          t('LWC.desktop.project.messages.reverted_to_valid_version'),
        );
      }
      return 'abort';
    }

    const content =
      contentOverride ??
      (await getActiveEditorContent()) ??
      tab.content ??
      context.state.editor.resource?.content ??
      null;

    if (!content) {
      context.actions.ui.notifyViaSnackbar('LWC.project.messages.could_not_read_document_content');
      return 'abort';
    }

    const saveResult = await saveActiveTabAs(context, { content });
    if (!saveResult.success) return 'abort';

    const savedPath = context.state.project.activeTabPath;
    if (savedPath) {
      await closeTab(context, { content, filePath: savedPath });
    }
    return 'handled';
  }

  const response = await window.electronAPI.showNativeMessageBox({
    type: 'warning',
    title: t('LWC.desktop.project.dialogs.unsaved_changes_title'),
    message: t('LWC.desktop.project.dialogs.close_without_saving', { filename: tab.filename }),
    buttons: [
      t('LWC.desktop.project.dialogs.discard_changes_button'),
      t('LWC.desktop.project.dialogs.cancel_button'),
    ],
    defaultId: 0,
    cancelId: 1,
  });

  if (response.response !== 0) return 'abort';
  return 'proceed';
};

const isSourceEditorMode = () => window.writer?.overmindState?.ui?.editorViewMode === 'source';

/**
 * Visual mode stores the TEI header outside TinyMCE and reattaches it on save.
 * Source mode edits the full document, so strip/merge would throw away header
 * (and other non-body) edits and can leave TinyMCE holding a stale pre-source
 * snapshot after save.
 */
const prepareXmlForDiskSave = (content: string, baseXml: string): string => {
  if (isSourceEditorMode()) return content;
  return mergeEditorBodyWithStoredHeader(stripTeiHeaderForVisualEditor(content), baseXml);
};

/**
 * Call immediately before a known write starts, so a slow renderer (busy
 * serializing/validating) can't lose the race against the watcher's debounce
 * timer between the write landing on disk and `ignoreSavedFileChange` below
 * confirming it — which otherwise surfaces as a false "modified outside" prompt.
 */
const armSavedFileWrite = async (filePath: string) => {
  if (!window.electronAPI?.armFileWrite) return;
  try {
    await window.electronAPI.armFileWrite(filePath);
  } catch {
    // ignore
  }
};

const ignoreSavedFileChange = async (filePath: string) => {
  if (!window.electronAPI?.statFile || !window.electronAPI?.ignoreFileChange) return;

  try {
    const { mtimeMs } = await window.electronAPI.statFile(filePath);
    await window.electronAPI.ignoreFileChange(filePath, mtimeMs);
  } catch {
    // ignore
  }
};

const pushContentToEditor = (content: string, options?: { resetUndo?: boolean }) => {
  if (!window.writer) return;

  if (isSourceEditorMode()) {
    if (options?.resetUndo) window.__leafWriterNextSourceSyncResetsUndo = true;
    window.writer.overmindActions?.ui?.markSourceSaved?.(content);
    window.writer.overmindActions?.ui?.setSourceCurrentContent?.(content);
    return;
  }

  // Visual mode needs no flag: loadDocumentXML already clears the undo stack on documentLoaded.
  window.writer.loadDocumentXML(content);
};

const getExplorerSchemaDirPath = (rootPath: string | null, schema?: { rng?: string } | null) =>
  rootPath ? getProjectSchemaDirPath(rootPath, schema) : null;

const loadTreeLevel = async (
  dirPath: string,
  schemaDirPath: string | null = null,
  projectRoot: string | null = null,
): Promise<FileTreeNode[]> => {
  if (!window.electronAPI) return [];
  const entries = await window.electronAPI.readDirectory(dirPath);
  return entries
    .filter((entry) => !shouldHideExplorerDirectoryEntry(entry.path, schemaDirPath, projectRoot))
    .map((entry) => ({
      ...entry,
      children: entry.isDirectory ? [] : undefined,
      childrenLoaded: !entry.isDirectory,
    }));
};

const invokeOpenProjectDialog = async (): Promise<ProjectBundle | null> => {
  const api = window.electronAPI;
  if (!api) return null;
  if (api.openProject) return api.openProject();
  // Backward compat with older preload builds.
  const legacy = api as typeof api & {
    openProjectFolder?: () => Promise<ProjectBundle | null>;
  };
  if (legacy.openProjectFolder) return legacy.openProjectFolder();
  return null;
};

const getActiveEditorContent = async (): Promise<string | null> => {
  if (isSourceEditorMode()) {
    const content =
      window.writer?.overmindState?.ui?.sourceCurrentContent ??
      window.__desktopStoredDocumentXml ??
      window.writer?.overmindState?.document?.xml ??
      null;
    return content || null;
  }

  if (window.writer?.getContent) {
    const content = await window.writer.getContent();
    if (!content) return null;

    if (isDesktop()) {
      const baseXml =
        window.__desktopStoredDocumentXml ?? window.writer.overmindState?.document?.xml ?? content;
      return mergeEditorBodyWithStoredHeader(stripTeiHeaderForVisualEditor(content), baseXml);
    }

    return content;
  }
  return null;
};

/** Write the live editor buffer into the active tab before leaving it. */
const persistActiveTabEditorContent = async ({ state, actions }: Context): Promise<void> => {
  if (!state.project.activeTabPath) return;

  const currentTab = state.project.openTabs.find(
    (tab) => tab.filePath === state.project.activeTabPath,
  );
  if (!currentTab) return;

  const content = await getActiveEditorContent();
  if (!content) return;

  let savedContent = content;
  if (window.electronAPI) {
    savedContent = await prepareFileContent(
      { state, actions } as Context,
      currentTab.filePath,
      content,
    );
  }
  currentTab.content = savedContent;
  currentTab.dirty = state.editor.contentHasChanged;
  if (!currentTab.lastSavedContent) {
    currentTab.lastSavedContent = state.editor.contentLastSaved || savedContent;
  }
  currentTab.editorReady = true;
};

const promptUnsavedBeforeProjectSwitch = async (context: Context): Promise<'proceed' | 'abort'> => {
  if (!window.electronAPI?.showNativeMessageBox) return 'proceed';

  const dirtyTabs = context.state.project.openTabs.filter((tab) => tab.dirty);
  if (dirtyTabs.length === 0) return 'proceed';

  const tempDirtyTabs = dirtyTabs.filter(isTempTab);
  const persistentDirtyTabs = dirtyTabs.filter((tab) => !isTempTab(tab));

  if (persistentDirtyTabs.length === 0 && tempDirtyTabs.length > 0) {
    const response = await window.electronAPI.showNativeMessageBox({
      type: 'warning',
      title: t('LWC.desktop.project.dialogs.unsaved_new_document_title'),
      message: t('LWC.desktop.project.dialogs.save_before_opening_project'),
      buttons: [
        t('LWC.desktop.project.dialogs.save_button'),
        t('LWC.desktop.project.dialogs.dont_save_button'),
        t('LWC.desktop.project.dialogs.cancel_button'),
      ],
      cancelId: 2,
      defaultId: 0,
    });

    if (response.response === 2) return 'abort';
    if (response.response === 1) return 'proceed';

    const activePath = context.state.project.activeTabPath;
    const tempTab = tempDirtyTabs.find((tab) => tab.filePath === activePath) ?? tempDirtyTabs[0];
    const content =
      (await getActiveEditorContent()) ??
      tempTab.content ??
      context.state.editor.resource?.content ??
      null;

    if (!content) {
      context.actions.ui.notifyViaSnackbar('LWC.project.messages.open_xml_before_saving');
      return 'abort';
    }

    const saveResult = await saveActiveTabAs(context, { content });
    if (!saveResult.success) return 'abort';
    return 'proceed';
  }

  const fileList = persistentDirtyTabs.map((tab) => tab.filename).join('\n');
  const response = await window.electronAPI.showNativeMessageBox({
    type: 'warning',
    title: t('LWC.desktop.project.dialogs.unsaved_documents_title'),
    message: t('LWC.desktop.project.dialogs.save_before_opening_project_with_list', {
      fileList,
    }),
    buttons: [
      t('LWC.desktop.project.dialogs.save_all_button'),
      t('LWC.desktop.project.dialogs.dont_save_button'),
      t('LWC.desktop.project.dialogs.cancel_button'),
    ],
    cancelId: 2,
    defaultId: 0,
  });

  if (response.response === 2) return 'abort';
  if (response.response === 0) {
    const saveResult = await saveAllDirtyTabs(context);
    if (!saveResult.ok) {
      context.actions.ui.notifyViaSnackbar(
        saveResult.error ?? 'LWC.project.messages.could_not_save_all_files',
      );
      return 'abort';
    }
  }

  return 'proceed';
};

export const saveAllDirtyTabs = async (
  context: Context,
): Promise<{ ok: boolean; error?: string }> => {
  const { state } = context;
  if (!window.electronAPI)
    return { ok: false, error: 'LWC.project.errors.desktop_file_access_unavailable' };

  const activePath = state.project.activeTabPath;
  let activeContent: string | null = null;

  if (
    activePath &&
    state.project.openTabs.some((tab) => tab.filePath === activePath && tab.dirty)
  ) {
    activeContent = await getActiveEditorContent();
    if (!activeContent) {
      activeContent =
        state.project.openTabs.find((tab) => tab.filePath === activePath)?.content ?? null;
    }
  }

  for (const tab of state.project.openTabs) {
    if (!tab.dirty) continue;

    if (isTempTab(tab)) {
      return {
        ok: false,
        error: 'LWC.project.errors.save_new_documents_before_switching_projects',
      };
    }

    const content = tab.filePath === activePath && activeContent ? activeContent : tab.content;

    try {
      await armSavedFileWrite(tab.filePath);
      await window.electronAPI.writeFile(tab.filePath, content);
      await ignoreSavedFileChange(tab.filePath);
    } catch {
      return {
        ok: false,
        error: t('LWC.desktop.project.errors.could_not_save_file', { filename: tab.filename }),
      };
    }
  }

  state.project.openTabs = state.project.openTabs.map((tab) => {
    if (!tab.dirty) return tab;
    const content = tab.filePath === activePath && activeContent ? activeContent : tab.content;
    return { ...tab, content, lastSavedContent: content, dirty: false };
  });

  if (activePath && activeContent) {
    state.editor.contentLastSaved = activeContent;
    state.editor.contentHasChanged = false;
  }

  return { ok: true };
};

const showExplorerLeftPanel = () => {
  window.__desktopLeftPanel?.showTab('explorer');
  window.dispatchEvent(
    new CustomEvent<DesktopLeftPanelShowDetail>(DESKTOP_LEFT_PANEL_EVENT, {
      detail: { tab: 'explorer' },
    }),
  );
};

const captureActiveCursorPosition = (state: Context['state']['project']) => {
  const activePath = state.activeTabPath;
  if (!activePath) return;

  const cursorPosition = window.__leafWriterCursorSession?.capture();
  if (cursorPosition) {
    state.cursorPositions = {
      ...state.cursorPositions,
      [activePath]: cursorPosition,
    };
  }
};

const loadProjectBundle = async (context: Context, bundle: ProjectBundle) => {
  const { state, actions } = context;
  state.project.rootPath = bundle.rootPath;
  state.project.projectFilePath = bundle.projectFilePath;
  state.project.config = bundle.config;
  state.project.projectSchemas = buildProjectSchemas(bundle.rootPath, bundle.config);
  state.project.tree = await loadTreeLevel(
    bundle.rootPath,
    getExplorerSchemaDirPath(bundle.rootPath, bundle.config?.schema),
    bundle.rootPath,
  );
  state.project.isProjectReady = true;
  state.project.explorerFocusedPath = null;
  state.project.explorerFocusedIsDirectory = false;

  if (window.writer) {
    window.writer.overmindActions?.editor?.clearProjectSchemas?.();
    registerDesktopSchemas([...getEnabledCatalogSchemas(), ...state.project.projectSchemas]);
  }

  window.writer?.overmindActions?.ui?.resetSourceEditor?.();

  if (isDesktop()) {
    void warmMetadataDialogStateCache(bundle, 'edition');
    void maybeCheckSchemaUpdateOnOpen(bundle.projectFilePath, {
      notify: (message) => actions.ui.notifyViaSnackbar(message),
      onBundleUpdated: (updatedBundle) => {
        state.project.config = updatedBundle.config;
        state.project.projectSchemas = buildProjectSchemas(
          updatedBundle.rootPath,
          updatedBundle.config,
        );
        if (window.writer) {
          registerDesktopSchemas([...getEnabledCatalogSchemas(), ...state.project.projectSchemas]);
        }
      },
    });
  }

  showExplorerLeftPanel();
};

/** Runs the onboarding steps that need `<ProjectEditor>` mounted (i.e.
 * `window.writer`), which is only true once the project is already loaded.
 * Re-applies any bundle changes (e.g. entity store metadata) to state. */
const runPostLoadOnboarding = async (context: Context, bundle: ProjectBundle) => {
  const updated = await completePostLoadOnboarding(bundle, context.actions.ui.openDialog);
  if (updated === bundle) return;

  context.state.project.config = updated.config;
  context.state.project.projectSchemas = buildProjectSchemas(updated.rootPath, updated.config);
  if (window.writer) {
    registerDesktopSchemas([
      ...getEnabledCatalogSchemas(),
      ...context.state.project.projectSchemas,
    ]);
  }
};

/** Re-sync main-process active project after cancelled onboarding. */
const restoreMainActiveProject = async (previousProjectFilePath: string | null) => {
  if (!window.electronAPI) return;
  if (previousProjectFilePath && window.electronAPI.reloadProjectBundle) {
    await window.electronAPI.reloadProjectBundle(previousProjectFilePath).catch(() => null);
    return;
  }
  await window.electronAPI.clearActiveProject?.().catch(() => undefined);
};

/** Shared tail of openProject / openRecentProject after a bundle is chosen in main. */
const finishOpeningProject = async (
  context: Context,
  bundle: ProjectBundle,
  previousProjectFilePath: string | null,
) => {
  const { notifyViaSnackbar } = context.actions.ui;

  const localEncoderName = await window.electronAPI?.getEncoderName?.();
  if (!localEncoderName?.trim()) {
    const projectEncoderName = await getProjectEncoderName(bundle);
    if (projectEncoderName) {
      await window.electronAPI?.setEncoderName?.(projectEncoderName);
      window.dispatchEvent(
        new CustomEvent('grognardEncoderNameInherited', { detail: projectEncoderName }),
      );
    }
  }

  const onboarded = await completeProjectOnboarding(bundle);
  if (!onboarded) {
    await restoreMainActiveProject(previousProjectFilePath);
    notifyViaSnackbar(t('LWC.desktop.project.messages.could_not_open_project_folder'));
    return;
  }

  context.state.project.openTabs = [];
  context.state.project.activeTabPath = null;
  context.state.project.cursorPositions = {};
  context.state.editor.contentHasChanged = false;
  context.state.editor.contentLastSaved = undefined;
  window.writer?.overmindActions?.ui?.resetSourceEditor?.();
  await context.actions.editor.clearResource();
  resetDesktopEditorSession();
  await loadProjectBundle(context, onboarded);
  await runPostLoadOnboarding(context, onboarded);
};

export const openProject = async (context: Context) => {
  const { notifyViaSnackbar } = context.actions.ui;

  if (!window.electronAPI) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.desktop_file_access_unavailable_restart'));
    return;
  }

  try {
    if (context.state.project.rootPath) {
      const guard = await promptUnsavedBeforeProjectSwitch(context);
      if (guard === 'abort') return;
    }

    const previousProjectFilePath = context.state.project.projectFilePath;

    const bundle = await invokeOpenProjectDialog();
    if (!bundle) return;

    await finishOpeningProject(context, bundle, previousProjectFilePath);
  } catch (error) {
    console.error('[project] openProject failed:', error);
    notifyViaSnackbar(t('LWC.desktop.project.messages.could_not_open_project_folder'));
    context.state.project.isProjectReady = true;
  }
};

export const openRecentProject = async (
  context: Context,
  { projectFilePath }: { projectFilePath: string },
) => {
  const { notifyViaSnackbar } = context.actions.ui;

  if (!window.electronAPI?.openProjectAtPath) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.desktop_file_access_unavailable_restart'));
    return;
  }

  if (!projectFilePath.trim()) return;

  try {
    if (context.state.project.rootPath) {
      const guard = await promptUnsavedBeforeProjectSwitch(context);
      if (guard === 'abort') return;
    }

    const previousProjectFilePath = context.state.project.projectFilePath;
    const bundle = await window.electronAPI.openProjectAtPath(projectFilePath);
    if (!bundle) return;

    await finishOpeningProject(context, bundle, previousProjectFilePath);
  } catch (error) {
    console.error('[project] openRecentProject failed:', error);
    notifyViaSnackbar(t('LWC.desktop.project.messages.could_not_open_project_folder'));
    context.state.project.isProjectReady = true;
  }
};

/**
 * Tears the current project down without opening another one, back to the
 * "Open a folder…" empty state — the same reset `openProject` already does
 * before loading a new bundle (see lines above), just without a bundle to
 * load afterward. Session persistence is untouched: relaunching still
 * restores whatever was last open, same as quitting with a project open.
 */
export const closeProject = async (context: Context) => {
  const { state, actions } = context;
  const { notifyViaSnackbar } = actions.ui;

  if (!state.project.rootPath) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
    return;
  }

  const guard = await promptUnsavedBeforeProjectSwitch(context);
  if (guard === 'abort') return;

  state.project.openTabs = [];
  state.project.activeTabPath = null;
  state.project.cursorPositions = {};
  state.editor.contentHasChanged = false;
  state.editor.contentLastSaved = undefined;
  window.writer?.overmindActions?.ui?.resetSourceEditor?.();
  await actions.editor.clearResource();
  resetDesktopEditorSession();

  if (window.writer) {
    window.writer.overmindActions?.editor?.clearProjectSchemas?.();
  }

  state.project.rootPath = null;
  state.project.projectFilePath = null;
  state.project.config = null;
  state.project.projectSchemas = [];
  state.project.tree = [];
  state.project.explorerFocusedPath = null;
  state.project.explorerFocusedIsDirectory = false;

  await window.electronAPI?.clearActiveProject?.().catch(() => undefined);
};

export const restoreLastProject = async (context: Context) => {
  if (!window.electronAPI?.restoreWorkspaceSession && !window.electronAPI?.restoreLastProject) {
    context.state.project.isProjectReady = true;
    return;
  }

  if (context.state.project.rootPath) {
    context.state.project.isProjectReady = true;
    return;
  }

  suppressWorkspaceSessionSave = true;
  try {
    console.info('[restore] requesting workspace session');
    const session = await window.electronAPI.restoreWorkspaceSession?.();
    console.info(`[restore] session: ${session ? 'found' : 'none'}`);
    const bundle = session?.bundle ?? (await window.electronAPI.restoreLastProject?.());
    console.info(`[restore] bundle: ${bundle?.projectFilePath ?? 'none'}`);
    if (!bundle) {
      context.state.project.isProjectReady = true;
      // Fresh install / no last project: set up the central entity database now
      // rather than surprising the user mid project-open later.
      await ensureEntityDbFolder();
      return;
    }

    const onboarded = await completeProjectOnboarding(bundle);
    if (!onboarded) {
      // restore* IPC already activated this bundle in main; clear so we don't
      // leave path guards pointed at a project the UI never loaded.
      await window.electronAPI.clearActiveProject?.().catch(() => undefined);
      context.state.project.isProjectReady = true;
      return;
    }

    await loadProjectBundle(context, onboarded);
    await runPostLoadOnboarding(context, onboarded);
    context.state.project.cursorPositions = filterVisualCursorPositions(
      session?.cursorPositions ?? {},
    );
    window.writer?.overmindActions?.ui?.resetSourceEditor?.();

    const openFilePaths = session?.openFilePaths ?? [];
    for (const filePath of openFilePaths) {
      try {
        await context.actions.project.restoreTabWithoutSync(filePath);
      } catch (error) {
        console.warn('[project] restoreWorkspaceSession skipped file:', filePath, error);
      }
    }

    const targetActivePath = session?.activeFilePath ?? openFilePaths[openFilePaths.length - 1];
    if (
      targetActivePath &&
      context.state.project.openTabs.some((tab) => tab.filePath === targetActivePath)
    ) {
      await context.actions.project.switchTab({ filePath: targetActivePath });
    }
  } catch (error) {
    console.error('[project] restoreLastProject failed:', error);
    context.state.project.isProjectReady = true;
  } finally {
    suppressWorkspaceSessionSave = false;
    await context.actions.project.saveWorkspaceSession();
  }
};

/** @deprecated Use openProject */
export const openProjectFolder = openProject;

/** Build a plain object safe for Electron IPC structured clone (Overmind proxies are not). */
const cloneableCursorPositions = (
  positions: Record<string, WorkspaceCursorPosition>,
): Record<string, WorkspaceCursorPosition> => {
  const out: Record<string, WorkspaceCursorPosition> = {};
  for (const [filePath, position] of Object.entries(positions)) {
    if (!position || typeof position !== 'object') continue;
    if (position.mode === 'source' && typeof position.offset === 'number') {
      out[filePath] = { mode: 'source', offset: position.offset };
    } else if (
      position.mode === 'visual' &&
      typeof position.teiXPath === 'string' &&
      typeof position.offsetInElementText === 'number'
    ) {
      out[filePath] = {
        mode: 'visual',
        teiXPath: position.teiXPath,
        offsetInElementText: position.offsetInElementText,
      };
    }
  }
  return out;
};

export const saveWorkspaceSession = async ({ state }: Context) => {
  if (suppressWorkspaceSessionSave) return;
  if (!window.electronAPI?.saveWorkspaceSession || !state.project.projectFilePath) return;

  const openFilePaths = state.project.openTabs
    .filter((tab) => !isTempTab(tab))
    .map((tab) => tab.filePath);
  const activeCursorPosition =
    state.project.activeTabPath && openFilePaths.includes(state.project.activeTabPath)
      ? (window.__leafWriterCursorSession?.capture() ?? null)
      : null;
  const cursorPositions = cloneableCursorPositions(
    activeCursorPosition && state.project.activeTabPath
      ? { ...state.project.cursorPositions, [state.project.activeTabPath]: activeCursorPosition }
      : state.project.cursorPositions,
  );

  try {
    await window.electronAPI.saveWorkspaceSession({
      activeFilePath:
        state.project.activeTabPath && openFilePaths.includes(state.project.activeTabPath)
          ? state.project.activeTabPath
          : null,
      cursorPositions,
      openFilePaths: [...openFilePaths],
      projectFilePath: state.project.projectFilePath,
    });
  } catch (error) {
    console.warn('[project] saveWorkspaceSession failed:', error);
  }
};

export const newFile = async (context: Context) => {
  const { notifyViaSnackbar } = context.actions.ui;
  const { state, actions } = context;

  if (!window.electronAPI?.createTempDocument) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.new_file_unavailable_restart'));
    return;
  }

  if (!state.project.isProjectReady || !state.project.rootPath || !state.project.config) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
    void actions.project.openProject();
    return;
  }

  if (!state.project.projectFilePath) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.project_not_fully_loaded'));
    return;
  }

  const bundle: ProjectBundle = {
    rootPath: state.project.rootPath,
    projectFilePath: state.project.projectFilePath,
    config: state.project.config,
  };

  if (!(await metadataFileExists(bundle))) {
    notifyViaSnackbar(
      t('LWC.desktop.project.messages.complete_metadata_setup_before_creating_file'),
    );
    return;
  }

  let content = buildSkeletonForCatalog(state.project.config);
  const metadata = await readProjectMetadata(bundle);
  if (metadata) {
    content = mergeMetadataIntoHeader(content, metadata);
  }

  try {
    const temp = await window.electronAPI.createTempDocument(content);
    const prepared = await prepareDesktopDocument(
      temp.filePath,
      content,
      state.project.rootPath,
      state.project.config?.schema,
    );
    content = prepared.content;
    registerDesktopSchemas([...state.project.projectSchemas, ...prepared.schemas]);

    const tab = {
      content,
      dirty: false,
      lastSavedContent: content,
      editorReady: true,
      filePath: temp.filePath,
      filename: temp.filename,
      isTemp: true,
    };

    state.project.openTabs = [...state.project.openTabs, tab];
    state.project.activeTabPath = temp.filePath;

    await actions.editor.setResource({
      content,
      filePath: temp.filePath,
      filename: temp.filename,
      isLocal: true,
    });
    state.editor.contentLastSaved = content;
  } catch (error) {
    console.error('[project] newFile failed:', error);
    notifyViaSnackbar(t('LWC.desktop.project.messages.could_not_create_new_file'));
  }
};

const getDocumentImportBaseOutputPaths = (rootPath: string, sources: DocumentImportSource[]) =>
  sources.map((source) => joinPath(rootPath, replaceExtension(source.relativePath, 'xml')));

const getExistingImportOutputPaths = async (
  rootPath: string,
  sources: DocumentImportSource[],
): Promise<string[]> => {
  if (!window.electronAPI?.pathExists) return [];

  const baseOutputPaths = getDocumentImportBaseOutputPaths(rootPath, sources);
  const checks = await Promise.all(
    baseOutputPaths.map(async (outputPath) => ({
      exists: await window.electronAPI?.pathExists?.(outputPath),
      outputPath,
    })),
  );

  return checks.filter((check) => check.exists).map((check) => check.outputPath);
};

const confirmDocumentImportOverwrite = async (
  existingCount: number,
): Promise<'cancel' | 'keepBoth' | 'overwrite'> => {
  if (!window.electronAPI?.showNativeMessageBox || existingCount === 0) return 'keepBoth';

  const result = await window.electronAPI.showNativeMessageBox({
    buttons: ['Cancel', 'Keep Both', 'Overwrite'],
    cancelId: 0,
    defaultId: 1,
    message:
      existingCount === 1
        ? 'One imported document would replace an existing XML file.'
        : `${existingCount} imported documents would replace existing XML files.`,
    title: 'Import documents',
    type: 'warning',
  });

  if (result.response === 2) return 'overwrite';
  if (result.response === 1) return 'keepBoth';
  return 'cancel';
};

const confirmXmlDocumentImport = async (xmlCount: number): Promise<boolean> => {
  if (!window.electronAPI?.showNativeMessageBox) return true;

  const result = await window.electronAPI.showNativeMessageBox({
    buttons: [
      t('LWC.desktop.project.dialogs.cancel_button'),
      t('LWC.desktop.project.dialogs.import_xml_continue_button'),
    ],
    cancelId: 0,
    defaultId: 1,
    detail: t('LWC.desktop.project.dialogs.import_xml_warning_detail'),
    message: t('LWC.desktop.project.dialogs.import_xml_warning_message', {
      documentCount: xmlCount,
    }),
    title: t('LWC.desktop.project.dialogs.import_xml_warning_title'),
    type: 'warning',
  });

  return result.response === 1;
};

const writeImportedDocument = async (
  item: DocumentImportPlanItem,
  config: ProjectBundle['config'],
  metadata: Awaited<ReturnType<typeof readProjectMetadata>>,
): Promise<{ keysDemoted: number; paragraphCount: number; xml: string }> => {
  if (!window.electronAPI) throw new Error('Desktop file APIs are unavailable.');

  let xml: string;
  let keysDemoted = 0;

  if (item.format === 'xml') {
    const { text } = await window.electronAPI.readFileAutoEncoding(item.sourcePath);
    const imported = buildImportedXmlDocument({
      config,
      sourcePath: item.sourcePath,
      xml: text,
    });
    xml = imported.xml;
    keysDemoted = imported.keysDemoted;
    logImportedXmlInspection({
      content: xml,
      outputPath: item.outputPath,
      sourcePath: item.sourcePath,
      stage: 'xml import transform',
    });
    assertImportedXmlWellFormed(xml, 'Imported XML is not well formed after transform');
  } else {
    const { text } =
      item.format === 'docx'
        ? await window.electronAPI.extractDocxText(item.sourcePath)
        : item.format === 'odt'
          ? await window.electronAPI.extractOdtText(item.sourcePath)
          : await window.electronAPI.readFileAutoEncoding(item.sourcePath);
    xml = buildImportedDocumentXml({
      config,
      format: item.format,
      sourcePath: item.sourcePath,
      text,
    });
    logImportedXmlInspection({
      content: xml,
      outputPath: item.outputPath,
      sourcePath: item.sourcePath,
      stage: 'body generation',
    });
    assertImportedXmlWellFormed(xml, 'Generated import XML is not well formed');
  }

  if (metadata) {
    xml = mergeMetadataIntoHeader(xml, metadata);
    logImportedXmlInspection({
      content: xml,
      outputPath: item.outputPath,
      sourcePath: item.sourcePath,
      stage: 'metadata merge',
    });
    assertImportedXmlWellFormed(xml, 'Imported XML is not well formed after metadata merge');
  }

  // Preserve existing XML formatting; only normalize spacing for freshly built docs.
  if (item.format !== 'xml') {
    xml = separateBlockElements(xml);
    logImportedXmlInspection({
      content: xml,
      outputPath: item.outputPath,
      sourcePath: item.sourcePath,
      stage: 'block formatting',
    });
    assertImportedXmlWellFormed(xml, 'Imported XML is not well formed after block formatting');
  }

  const parentDir = getParentPath(item.outputPath);
  if (parentDir) await window.electronAPI.ensureDirectory(parentDir);
  await window.electronAPI.writeFile(item.outputPath, xml);

  const writtenXml = await window.electronAPI.readFile(item.outputPath);
  logImportedXmlInspection({
    content: writtenXml,
    outputPath: item.outputPath,
    sourcePath: item.sourcePath,
    stage: 'disk write',
  });
  assertImportedXmlWellFormed(writtenXml, 'Written import XML is not well formed');

  return { keysDemoted, paragraphCount: countImportedParagraphs(writtenXml), xml: writtenXml };
};

const formatDocumentImportProblems = (problems: DocumentImportProblem[]): string =>
  problems
    .slice(0, 5)
    .map((problem) => {
      const sourceName = getFilename(problem.sourcePath);
      const outputName = problem.outputPath ? getFilename(problem.outputPath) : null;
      return `${sourceName}${outputName ? ` -> ${outputName}` : ''}: ${problem.message}`;
    })
    .join('\n');

const showDocumentImportReportDialog = async ({
  entries,
  problemCount,
  problems,
  writtenCount,
}: {
  entries: DocumentImportReportEntry[];
  problemCount: number;
  problems: DocumentImportProblem[];
  writtenCount: number;
}) => {
  if (
    !window.electronAPI?.showNativeMessageBox ||
    (entries.length === 0 && problems.length === 0)
  ) {
    return;
  }

  const { schemaInvalidCount, schemaUnavailableCount, schemaValidCount } =
    summarizeDocumentImportReport(entries);
  const detailParts = [
    entries.length > 0 ? formatDocumentImportReportDetail(entries, t) : '',
    problems.length > 0 ? formatDocumentImportProblems(problems) : '',
  ].filter(Boolean);
  const detail = detailParts.join('\n\n');
  const hasProblems = problemCount > 0 || schemaInvalidCount > 0;

  void window.electronAPI.showNativeMessageBox({
    buttons: [t('LWC.desktop.project.dialogs.ok_button')],
    defaultId: 0,
    detail,
    message: hasProblems
      ? t('LWC.desktop.project.dialogs.import_report_with_issues_message', {
          documentCount: writtenCount,
          problemCount,
          schemaInvalidCount,
        })
      : t('LWC.desktop.project.dialogs.import_report_success_message', {
          documentCount: writtenCount,
          schemaUnavailableCount,
          schemaValidCount,
        }),
    title: t('LWC.desktop.project.dialogs.import_report_title'),
    type: hasProblems ? 'warning' : 'info',
  });
};

export const importDocuments = async (context: Context) => {
  const { state, actions } = context;
  const { notifyViaSnackbar } = actions.ui;

  if (!window.electronAPI?.pickDocumentImportSources) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.document_import_unavailable_restart'));
    return;
  }

  if (!state.project.isProjectReady || !state.project.rootPath || !state.project.config) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
    void actions.project.openProject();
    return;
  }

  if (!state.project.projectFilePath) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.project_not_fully_loaded'));
    return;
  }

  const sources = await window.electronAPI.pickDocumentImportSources();
  if (!sources) return;
  if (sources.length === 0) {
    notifyViaSnackbar(t('LWC.desktop.project.messages.no_supported_files_found'));
    return;
  }

  const xmlSourceCount = sources.filter((source) => source.format === 'xml').length;
  if (xmlSourceCount > 0) {
    const confirmed = await confirmXmlDocumentImport(xmlSourceCount);
    if (!confirmed) return;
  }

  const existingOutputPaths = await getExistingImportOutputPaths(state.project.rootPath, sources);
  const overwriteChoice = await confirmDocumentImportOverwrite(existingOutputPaths.length);
  if (overwriteChoice === 'cancel') return;

  const plan = buildDocumentImportPlan({
    destinationRoot: state.project.rootPath,
    existingOutputPaths: overwriteChoice === 'keepBoth' ? existingOutputPaths : [],
    sources,
  });

  const bundle: ProjectBundle = {
    config: state.project.config,
    projectFilePath: state.project.projectFilePath,
    rootPath: state.project.rootPath,
  };
  const metadata = await readProjectMetadata(bundle);
  const problems: DocumentImportProblem[] = [];
  const reportEntries: DocumentImportReportEntry[] = [];
  const writtenPaths: string[] = [];
  let keysDemotedTotal = 0;

  for (const item of plan) {
    try {
      const written = await writeImportedDocument(item, state.project.config, metadata);
      const schemaValidation = await validateImportedXmlRelaxNg(written.xml, {
        config: state.project.config,
        rootPath: state.project.rootPath,
      });
      reportEntries.push({
        keysDemoted: written.keysDemoted,
        outputPath: item.outputPath,
        paragraphCount: written.paragraphCount,
        schemaValidation,
        sourceFormat: item.format,
        sourcePath: item.sourcePath,
      });
      writtenPaths.push(item.outputPath);
      keysDemotedTotal += written.keysDemoted;
    } catch (error) {
      problems.push({
        message: error instanceof Error ? error.message : String(error),
        outputPath: item.outputPath,
        sourcePath: item.sourcePath,
      });
    }
  }

  const schemaDirPath = getExplorerSchemaDirPath(
    state.project.rootPath,
    state.project.config?.schema,
  );
  state.project.tree = await loadTreeLevel(
    state.project.rootPath,
    schemaDirPath,
    state.project.rootPath,
  );
  if (writtenPaths.length > 0 && window.electronAPI?.syncWatchedFiles) {
    await window.electronAPI.syncWatchedFiles(state.project.openTabs.map((tab) => tab.filePath));
  }

  await ensureImportHeaderEntitiesForPaths(writtenPaths);

  if (writtenPaths[0]) {
    try {
      const firstXml = await window.electronAPI.readFile(writtenPaths[0]);
      logImportedXmlInspection({
        content: firstXml,
        outputPath: writtenPaths[0],
        sourcePath: writtenPaths[0],
        stage: 'before opening first imported file',
      });
      assertImportedXmlWellFormed(firstXml, 'First imported XML is not well formed before open');
      await actions.project.openFile(writtenPaths[0]);
    } catch (error) {
      problems.push({
        message: error instanceof Error ? error.message : String(error),
        outputPath: writtenPaths[0],
        sourcePath: writtenPaths[0],
      });
    }
  }

  if (reportEntries.length > 0 || problems.length > 0) {
    await showDocumentImportReportDialog({
      entries: reportEntries,
      problemCount: problems.length,
      problems,
      writtenCount: writtenPaths.length,
    });
  }

  if (problems.length > 0) {
    console.warn('[document-import] completed with problems', problems);
    notifyViaSnackbar({
      message: t('LWC.desktop.project.messages.imported_documents_with_problems_snackbar', {
        documentCount: writtenPaths.length,
        problemCount: problems.length,
      }),
      options: { variant: writtenPaths.length > 0 ? 'warning' : 'error' },
    });
    return;
  }

  notifyViaSnackbar({
    message:
      keysDemotedTotal > 0
        ? t('LWC.desktop.project.messages.imported_documents_success_with_keys', {
            documentCount: writtenPaths.length,
            keyCount: keysDemotedTotal,
          })
        : t('LWC.desktop.project.messages.imported_documents_success', {
            documentCount: writtenPaths.length,
          }),
    options: { variant: 'success' },
  });
};

export const loadDirectoryChildren = async ({ state }: Context, dirPath: string) => {
  const schemaDirPath = getExplorerSchemaDirPath(
    state.project.rootPath,
    state.project.config?.schema,
  );
  const updateTree = async (nodes: FileTreeNode[]): Promise<FileTreeNode[]> => {
    return Promise.all(
      nodes.map(async (node) => {
        if (node.path === dirPath && node.isDirectory && !node.childrenLoaded) {
          const children = await loadTreeLevel(dirPath, schemaDirPath, state.project.rootPath);
          return { ...node, children, childrenLoaded: true };
        }
        if (node.children) {
          return { ...node, children: await updateTree(node.children) };
        }
        return node;
      }),
    );
  };

  state.project.tree = await updateTree(state.project.tree);
};

const prepareFileContent = async ({ state }: Context, filePath: string, content: string) => {
  if (!window.electronAPI || !state.project.rootPath || !state.project.isProjectReady) {
    return content;
  }

  const prepared = await prepareDesktopDocument(
    filePath,
    content,
    state.project.rootPath,
    state.project.config?.schema,
  );

  registerDesktopSchemas([...state.project.projectSchemas, ...prepared.schemas]);

  return normalizeTeiHeaderLanguageElements(prepared.content);
};

/**
 * Loads a saved tab's content into project state during workspace restore,
 * without touching the live editor singleton. `openFile` can't be reused for
 * this: it round-trips every restored tab through `window.writer`, and since
 * that singleton loads asynchronously, back-to-back calls race and stamp one
 * tab's stale editor content onto another. Only the tab that ends up active
 * needs a real editor sync, done once via `switchTab` after this loop.
 */
export const restoreTabWithoutSync = async ({ state, actions }: Context, filePath: string) => {
  if (!window.electronAPI || !state.project.isProjectReady || !state.project.rootPath) return;
  if (isCorpusExcludedPath(filePath, state.project.rootPath)) return;
  if (state.project.openTabs.some((tab) => tab.filePath === filePath)) return;

  let content = await window.electronAPI.readFile(filePath);
  content = await prepareFileContent({ state, actions } as Context, filePath, content);
  const filename = getFilename(filePath);
  const tab = {
    content,
    dirty: false,
    lastSavedContent: content,
    editorReady: true,
    filePath,
    filename,
  };

  state.project.openTabs = [...state.project.openTabs, tab];
};

export const refreshExplorer = async ({ state }: Context) => {
  if (!state.project.rootPath) return;
  const schemaDirPath = getExplorerSchemaDirPath(
    state.project.rootPath,
    state.project.config?.schema,
  );
  state.project.tree = await loadTreeLevel(
    state.project.rootPath,
    schemaDirPath,
    state.project.rootPath,
  );
};

export const openFile = async (context: Context, filePath: string) => {
  const { state, actions } = context;
  if (!window.electronAPI || !state.project.isProjectReady || !state.project.rootPath) return;
  if (isCorpusExcludedPath(filePath, state.project.rootPath)) return;
  const existing = state.project.openTabs.find((tab) => tab.filePath === filePath);
  if (existing) {
    await actions.project.switchTab({ filePath });
    return;
  }

  await persistActiveTabEditorContent(context);

  let content = await window.electronAPI.readFile(filePath);
  content = await prepareFileContent({ state, actions } as Context, filePath, content);
  const filename = getFilename(filePath);
  const tab = {
    content,
    dirty: false,
    lastSavedContent: content,
    editorReady: true,
    filePath,
    filename,
  };

  state.project.openTabs = [...state.project.openTabs, tab];
  state.project.activeTabPath = filePath;

  await actions.editor.setResource({
    content,
    filePath,
    filename,
    isLocal: true,
  });
  state.editor.contentLastSaved = content;
  await actions.project.saveWorkspaceSession();
};

export const switchTab = async (
  context: Context,
  { content, filePath }: { content?: string; filePath: string },
) => {
  const { state, actions } = context;
  captureActiveCursorPosition(state.project);

  if (state.project.activeTabPath && state.project.activeTabPath !== filePath) {
    if (content) {
      const currentTab = state.project.openTabs.find(
        (tab) => tab.filePath === state.project.activeTabPath,
      );
      if (currentTab) {
        let savedContent = content;
        if (window.electronAPI) {
          savedContent = await prepareFileContent(context, currentTab.filePath, content);
        }
        currentTab.content = savedContent;
        // Trust the editor's dirty flag — string-comparing XML against a shared
        // contentLastSaved falsely dirties other tabs after save/stamp.
        currentTab.dirty = state.editor.contentHasChanged;
        if (!currentTab.lastSavedContent) {
          currentTab.lastSavedContent = state.editor.contentLastSaved || savedContent;
        }
        currentTab.editorReady = true;
      }
    } else {
      await persistActiveTabEditorContent(context);
    }
  }

  const tab = state.project.openTabs.find((item) => item.filePath === filePath);
  if (!tab) return;

  if (!tab.editorReady) {
    tab.content = await prepareFileContent(
      { state, actions } as Context,
      tab.filePath,
      tab.content,
    );
    tab.editorReady = true;
  }

  if (!tab.lastSavedContent) {
    tab.lastSavedContent = tab.dirty ? state.editor.contentLastSaved || tab.content : tab.content;
  }

  state.project.activeTabPath = filePath;
  // Baseline for the incoming tab — never the dirty buffer, or close/save
  // prompts lose track of unsaved edits.
  state.editor.contentLastSaved = tab.lastSavedContent;
  state.editor.contentHasChanged = tab.dirty;

  await actions.editor.setResource({
    content: tab.content,
    filePath: tab.filePath,
    filename: tab.filename,
    isLocal: true,
  });
  await actions.project.saveWorkspaceSession();
};

export const saveActiveTab = async (
  context: Context,
  { content }: { content: string },
): Promise<{ success: boolean; content?: string; error?: string; skipped?: boolean }> => {
  const { state } = context;
  if (!window.electronAPI || !state.project.activeTabPath) {
    return { success: false, error: 'No active file' };
  }

  const filePath = state.project.activeTabPath;
  const tab = state.project.openTabs.find((item) => item.filePath === filePath);
  if (tab && isTempTab(tab)) {
    return saveActiveTabAs(context, { content });
  }

  if (!state.editor.contentHasChanged && !tab?.dirty) {
    return { success: true, skipped: true };
  }

  try {
    const savedFromSourceMode = isSourceEditorMode();
    const baseXml = window.__desktopStoredDocumentXml ?? tab?.content ?? content;
    const merged = prepareXmlForDiskSave(content, baseXml);
    const stamped = separateBlockElements(
      await stampContentBeforeSave(merged, state.project.config?.schema?.catalogId),
    );
    await armSavedFileWrite(filePath);
    await window.electronAPI.writeFile(filePath, stamped);
    if (state.project.rootPath) {
      const rootPath = state.project.rootPath;
      const notifyAchievement = (message: string) =>
        context.actions.ui.notifyViaSnackbar({
          message,
          options: { variant: 'success', autoHideDuration: 7000 },
        });
      void updateTagStatsForFile(rootPath, filePath, stamped)
        .catch(() => ({
          version: 1 as const,
          project: { tags: {}, attrs: {}, attrValues: {} },
          files: {},
        }))
        .then((merged) =>
          processSaveForAchievements({
            rootPath,
            projectId: state.project.config?.projectId,
            filePath,
            xml: stamped,
            stats: merged,
            sourceMode: savedFromSourceMode,
            notify: notifyAchievement,
          }),
        )
        .catch(() => {
          // Achievements are decorative; never surface as an unhandled rejection.
        });
    }
    state.project.openTabs = state.project.openTabs.map((tab) =>
      tab.filePath === filePath
        ? { ...tab, content: stamped, lastSavedContent: stamped, dirty: false }
        : tab,
    );
    state.editor.contentLastSaved = stamped;
    state.editor.contentHasChanged = false;
    window.__desktopStoredDocumentXml = stamped;
    window.writer?.overmindActions?.document?.setDocumentXml?.(stamped);
    await ignoreSavedFileChange(filePath);

    if (isSourceEditorMode()) {
      pushContentToEditor(stamped);
    }

    const reindexed = await reindexTranslationOnSave(filePath, stamped);
    if (reindexed) {
      await context.actions.project.reloadTabFromDisk(filePath);
      return { success: true, content: reindexed };
    }

    return { success: true, content: stamped };
  } catch {
    return { success: false, error: 'Failed to save file' };
  }
};

export const setExternalChangePending = (
  { state }: Context,
  { filePath, pending }: { filePath: string; pending: boolean },
) => {
  state.project.openTabs = state.project.openTabs.map((tab) =>
    tab.filePath === filePath ? { ...tab, externalChangePending: pending } : tab,
  );
};

export const reloadTabFromDisk = async ({ state, actions }: Context, filePath: string) => {
  if (!window.electronAPI || !state.project.isProjectReady) return false;

  const tab = state.project.openTabs.find((item) => item.filePath === filePath);
  if (!tab) return false;

  try {
    let content = await window.electronAPI.readFile(filePath);
    content = await prepareFileContent({ state, actions } as Context, filePath, content);

    state.project.openTabs = state.project.openTabs.map((item) =>
      item.filePath === filePath
        ? {
            ...item,
            content,
            lastSavedContent: content,
            dirty: false,
            externalChangePending: false,
          }
        : item,
    );

    if (state.project.activeTabPath === filePath) {
      state.editor.contentHasChanged = false;
      state.editor.contentLastSaved = content;

      await actions.editor.setResource({
        content,
        filePath,
        filename: tab.filename,
        isLocal: true,
      });

      pushContentToEditor(content, { resetUndo: true });
    }

    await ignoreSavedFileChange(filePath);
    return true;
  } catch {
    return false;
  }
};

export interface MergeTabWithDiskResult {
  success: boolean;
  imported?: number;
  reconciled?: number;
  conflicts?: number;
}

/**
 * Third option for the external-change prompt on an entities.xml tab: instead of
 * discarding one side wholesale (Reload) or ignoring the other (Keep editing),
 * fork-merge the on-disk copy into the in-memory one via `mergeForkedCentral`
 * (additions union, non-conflicting fields auto-reconcile, true conflicts are
 * left on the in-memory side and reported back for the caller to surface).
 */
export const mergeTabWithDisk = async (
  { state, actions }: Context,
  filePath: string,
): Promise<MergeTabWithDiskResult> => {
  if (!window.electronAPI || !state.project.isProjectReady) return { success: false };

  const tab = state.project.openTabs.find((item) => item.filePath === filePath);
  if (!tab) return { success: false };

  try {
    const diskXml = await window.electronAPI.readFile(filePath);
    const intoDoc = parseEntities(tab.lastSavedContent || tab.content);
    const fromDoc = parseEntities(diskXml);

    if (!isEntityDatabase(intoDoc) || !isEntityDatabase(fromDoc)) return { success: false };

    const result = mergeForkedCentral(intoDoc, fromDoc, { keepNewest: true });
    const content = serializeEntities(intoDoc);

    await armSavedFileWrite(filePath);
    await window.electronAPI.writeFile(filePath, content);

    state.project.openTabs = state.project.openTabs.map((item) =>
      item.filePath === filePath
        ? {
            ...item,
            content,
            lastSavedContent: content,
            dirty: false,
            externalChangePending: false,
          }
        : item,
    );

    if (state.project.activeTabPath === filePath) {
      state.editor.contentHasChanged = false;
      state.editor.contentLastSaved = content;

      await actions.editor.setResource({
        content,
        filePath,
        filename: tab.filename,
        isLocal: true,
      });

      pushContentToEditor(content, { resetUndo: true });
    }

    await ignoreSavedFileChange(filePath);

    return {
      success: true,
      imported: result.imported,
      reconciled: result.reconciled,
      conflicts: result.conflicts.length,
    };
  } catch {
    return { success: false };
  }
};

/** Save As default: explorer focus, else project root (never app temp dir). */
const getDefaultSaveAsPath = (
  state: Context['state']['project'],
  previousPath?: string,
): string | undefined => {
  const tab = previousPath
    ? state.openTabs.find((item) => item.filePath === previousPath)
    : undefined;
  const filename = tab?.filename ?? (previousPath ? getFilename(previousPath) : 'untitled.xml');
  const isTempFile = Boolean(tab?.isTemp || (previousPath && isTempDocumentPath(previousPath)));

  return buildDefaultSaveAsPath({
    rootPath: state.rootPath,
    explorerFocusedPath: state.explorerFocusedPath,
    explorerFocusedIsDirectory: state.explorerFocusedIsDirectory,
    filename,
    previousPath,
    isTempFile,
  });
};

export const setExplorerFocusedPath = (
  { state }: Context,
  payload: { path: string; isDirectory: boolean },
) => {
  if (!state.project.rootPath || !payload.path.startsWith(state.project.rootPath)) return;
  state.project.explorerFocusedPath = payload.path;
  state.project.explorerFocusedIsDirectory = payload.isDirectory;
};

export const saveActiveTabAs = async (
  { state, actions }: Context,
  { content }: { content: string },
): Promise<{ success: boolean; cancelled?: boolean; content?: string; error?: string }> => {
  if (!window.electronAPI) {
    return { success: false, error: 'Save is only available in the desktop app' };
  }

  if (typeof window.electronAPI.saveFileAs !== 'function') {
    return {
      success: false,
      error: 'Save As is unavailable. Quit and restart the desktop app.',
    };
  }

  const previousPath = state.project.activeTabPath ?? undefined;
  const defaultSavePath = getDefaultSaveAsPath(state.project, previousPath);
  let filePath: string | null;
  try {
    filePath = await window.electronAPI.saveFileAs(defaultSavePath);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Save As failed',
    };
  }

  if (!filePath) {
    return { success: false, cancelled: true };
  }

  try {
    const savedFromSourceMode = isSourceEditorMode();
    const sourceTab = previousPath
      ? state.project.openTabs.find((item) => item.filePath === previousPath)
      : state.project.openTabs.find((item) => item.filePath === state.project.activeTabPath);
    const baseXml = window.__desktopStoredDocumentXml ?? sourceTab?.content ?? content;
    const merged = prepareXmlForDiskSave(content, baseXml);
    const stamped = separateBlockElements(
      await stampContentBeforeSave(merged, state.project.config?.schema?.catalogId),
    );
    await armSavedFileWrite(filePath);
    await window.electronAPI.writeFile(filePath, stamped);
    const filename = getFilename(filePath);

    // The save dialog can return a path another open tab already occupies (e.g. saving
    // two different "New File" tabs to the same destination). Drop that tab first so we
    // never end up with two openTabs entries sharing one filePath (duplicate React key,
    // stale editor state on switch).
    state.project.openTabs = state.project.openTabs.filter(
      (tab) => tab.filePath !== filePath || tab.filePath === previousPath,
    );

    if (previousPath) {
      state.project.openTabs = state.project.openTabs.map((tab) =>
        tab.filePath === previousPath
          ? {
              ...tab,
              filePath,
              filename,
              content: stamped,
              lastSavedContent: stamped,
              dirty: false,
              isTemp: false,
            }
          : tab,
      );
      state.project.activeTabPath = filePath;
    } else {
      state.project.openTabs = [
        ...state.project.openTabs,
        {
          content: stamped,
          dirty: false,
          lastSavedContent: stamped,
          editorReady: true,
          filePath,
          filename,
          isTemp: false,
        },
      ];
      state.project.activeTabPath = filePath;
    }

    await actions.editor.setResource({
      content: stamped,
      filePath,
      filename,
      isLocal: true,
    });

    state.editor.contentLastSaved = stamped;
    state.editor.contentHasChanged = false;
    window.__desktopStoredDocumentXml = stamped;
    window.writer?.overmindActions?.document?.setDocumentXml?.(stamped);
    await ignoreSavedFileChange(filePath);
    if (state.project.rootPath) {
      await reloadDirectoryInTree({ state } as Context, getParentPath(filePath));
      const rootPath = state.project.rootPath;
      const notifyAchievement = (message: string) =>
        actions.ui.notifyViaSnackbar({
          message,
          options: { variant: 'success', autoHideDuration: 7000 },
        });
      void updateTagStatsForFile(rootPath, filePath, stamped)
        .catch(() => ({
          version: 1 as const,
          project: { tags: {}, attrs: {}, attrValues: {} },
          files: {},
        }))
        .then((merged) =>
          processSaveForAchievements({
            rootPath,
            projectId: state.project.config?.projectId,
            filePath,
            xml: stamped,
            stats: merged,
            sourceMode: savedFromSourceMode,
            notify: notifyAchievement,
          }),
        )
        .catch(() => {
          // Achievements are decorative; never surface as an unhandled rejection.
        });
    }

    const reindexed = await reindexTranslationOnSave(filePath, stamped);
    if (reindexed) {
      await actions.project.reloadTabFromDisk(filePath);
      return { success: true, content: reindexed };
    }

    return { success: true, content: stamped };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save file',
    };
  }
};

export const isTabContentStaleOnDisk = async (
  { state, actions }: Context,
  filePath: string,
): Promise<boolean> => {
  const tab = state.project.openTabs.find((item) => item.filePath === filePath);
  if (!tab || !window.electronAPI) return false;

  try {
    let diskContent = await window.electronAPI.readFile(filePath);
    diskContent = await prepareFileContent({ state, actions } as Context, filePath, diskContent);

    // Compare against what we last knew was on disk — not the dirty in-memory
    // buffer. Tag bomb (and other in-app applies) update `tab.content` without
    // writing the file; on Windows a spurious fs.watch event then made
    // disk≠tab.content look like an external edit and popped this dialog.
    let baseline = tab.lastSavedContent || tab.content;
    const isSourceActive =
      state.project.activeTabPath === filePath &&
      window.writer?.overmindState?.ui?.editorViewMode === 'source';

    if (isSourceActive) {
      const sourceOriginal = window.writer?.overmindState?.ui?.sourceOriginalContent;
      if (sourceOriginal) {
        baseline = await prepareFileContent(
          { state, actions } as Context,
          filePath,
          sourceOriginal,
        );
      }
    }

    return diskContent !== baseline;
  } catch {
    return false;
  }
};

export const closeTab = async (
  { state, actions }: Context,
  { content, filePath }: { content?: string; filePath: string },
) => {
  if (state.project.activeTabPath === filePath) {
    captureActiveCursorPosition(state.project);
    // Validation/disambiguation/auto-tagging review are all scoped to whatever
    // document is currently loaded in the shared writer, so they only need
    // closing when the tab being closed is the one they belong to.
    window.__desktopRightPanel?.dismissTab('validation');
    window.writer?.overmindActions?.ui?.dismissReviewPanes?.();
  }

  if (content) {
    const tab = state.project.openTabs.find((item) => item.filePath === filePath);
    if (tab) tab.content = content;
  }

  const closingTab = state.project.openTabs.find((tab) => tab.filePath === filePath);
  if (closingTab && isTempTab(closingTab)) {
    await deleteTempDocumentAt(filePath);
  }

  const remaining = state.project.openTabs.filter((tab) => tab.filePath !== filePath);
  state.project.openTabs = remaining;

  if (state.project.activeTabPath !== filePath) {
    await actions.project.saveWorkspaceSession();
    return;
  }

  if (remaining.length === 0) {
    state.project.activeTabPath = null;
    state.editor.contentHasChanged = false;
    state.editor.contentLastSaved = undefined;
    await actions.editor.clearResource();
    clearWriterSession();
    showExplorerLeftPanel();
    await actions.project.saveWorkspaceSession();
    return;
  }

  const nextTab = remaining[remaining.length - 1];
  await actions.project.switchTab({ filePath: nextTab.filePath });
};

export const markTabDirty = ({ state }: Context, dirty: boolean) => {
  if (!state.project.activeTabPath) return;
  state.project.openTabs = state.project.openTabs.map((tab) =>
    tab.filePath === state.project.activeTabPath ? { ...tab, dirty } : tab,
  );
};

export const updateTabContent = (
  { state }: Context,
  { content, filePath }: { content: string; filePath: string },
) => {
  const tab = state.project.openTabs.find((item) => item.filePath === filePath);
  if (tab) tab.content = content;
  if (state.project.activeTabPath === filePath && state.editor.resource?.filePath === filePath) {
    state.editor.resource = { ...state.editor.resource, content };
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.__desktopStoredDocumentXml = content;
    }
  }
};

export const reloadDirectoryInTree = async ({ state }: Context, dirPath: string) => {
  const schemaDirPath = getExplorerSchemaDirPath(
    state.project.rootPath,
    state.project.config?.schema,
  );
  const children = await loadTreeLevel(dirPath, schemaDirPath, state.project.rootPath);
  const isProjectRoot = Boolean(state.project.rootPath && dirPath === state.project.rootPath);
  if (isProjectRoot) {
    state.project.tree = children;
    return;
  }

  state.project.tree = updateTreeNode(state.project.tree, dirPath, (node) => ({
    ...node,
    children,
    childrenLoaded: true,
  }));
};

const repathOpenTabsForMove = ({ state, actions }: Context, oldPath: string, newPath: string) => {
  let nextActiveTabPath = state.project.activeTabPath;

  state.project.openTabs = state.project.openTabs.map((tab) => {
    const repathed = repathFilePath(tab.filePath, oldPath, newPath);
    if (!repathed) return tab;
    return { ...tab, filePath: repathed, filename: getPathBasename(repathed) };
  });

  if (nextActiveTabPath) {
    const repathedActive = repathFilePath(nextActiveTabPath, oldPath, newPath);
    if (repathedActive) nextActiveTabPath = repathedActive;
  }

  state.project.activeTabPath = nextActiveTabPath;

  if (
    nextActiveTabPath &&
    state.editor.resource?.filePath &&
    repathFilePath(state.editor.resource.filePath, oldPath, newPath)
  ) {
    const tab = state.project.openTabs.find((item) => item.filePath === nextActiveTabPath);
    if (tab) {
      void actions.editor.setResource({
        content: tab.content,
        filePath: tab.filePath,
        filename: tab.filename,
        isLocal: true,
      });
    }
  }
};

export const createExplorerFolder = async (
  { state }: Context,
  { folderName, parentPath }: { folderName: string; parentPath: string },
): Promise<{ success: boolean; error?: string }> => {
  if (!window.electronAPI?.createDirectory) {
    return { success: false, error: 'Unavailable' };
  }

  const trimmed = folderName.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
    return { success: false, error: 'invalid_name' };
  }

  try {
    await window.electronAPI.createDirectory(parentPath, trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create folder';
    if (message.includes('exists')) return { success: false, error: 'exists' };
    if (message.includes('Invalid')) return { success: false, error: 'invalid_name' };
    return { success: false, error: message };
  }

  await reloadDirectoryInTree({ state } as Context, parentPath);
  return { success: true };
};

export const renameExplorerItem = async (
  { state, actions }: Context,
  { oldPath, newName }: { oldPath: string; newName: string },
): Promise<{ success: boolean; error?: string }> => {
  if (!window.electronAPI?.renamePath || !state.project.rootPath) {
    return { success: false, error: 'Unavailable' };
  }

  const trimmed = newName.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
    return { success: false, error: 'invalid_name' };
  }

  const parentDir = getParentPath(oldPath);
  const newPath = joinPath(parentDir, trimmed);

  if (newPath === oldPath) return { success: true };

  // Resolve companions before the rename — their paths derive from the source filename.
  const companions = await findCompanionTranslationFiles(oldPath);

  // The main process performs the actual `fs.rename` and returns the OS-native path
  // (backslash-separated on Windows); using that instead of the forward-slash `newPath`
  // built above keeps tree/tab state consistent with what readDirectory/watchers report.
  let renamedPath: string;
  try {
    renamedPath = await window.electronAPI.renamePath(oldPath, newPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to rename';
    if (message.includes('exists')) return { success: false, error: 'exists' };
    return { success: false, error: message };
  }

  for (const companion of companions) {
    try {
      const newCompanionPath = translationFilePathFor(renamedPath, companion.lang);

      await window.electronAPI.renamePath(companion.path, newCompanionPath);

      // The companion's @corresp values still reference the old source filename — rewrite
      // them, or every unit lookup silently fails after the rename.

      const companionXml = await window.electronAPI.readFile(newCompanionPath);
      const rewritten = rewriteCompanionSourceReferences(
        companionXml,
        getFilename(oldPath),
        getFilename(renamedPath),
      );
      if (rewritten && rewritten !== companionXml) {
        await window.electronAPI.writeFile(newCompanionPath, rewritten);
      }
    } catch (error) {
      console.warn('[translation] failed to rename companion file', companion.path, error);
    }
  }

  state.project.tree = repathTreeSubtree(state.project.tree, oldPath, renamedPath);
  repathOpenTabsForMove({ state, actions } as Context, oldPath, renamedPath);
  await reloadDirectoryInTree({ state } as Context, parentDir);
  await ignoreSavedFileChange(renamedPath);
  return { success: true };
};

export const moveExplorerItem = async (
  { state, actions }: Context,
  { sourcePath, destDir }: { sourcePath: string; destDir: string },
): Promise<{ success: boolean; error?: string }> => {
  if (!window.electronAPI?.movePath) {
    return { success: false, error: 'Unavailable' };
  }

  const companions = await findCompanionTranslationFiles(sourcePath);

  try {
    const newPath = await window.electronAPI.movePath(sourcePath, destDir);
    const oldParent = getParentPath(sourcePath);

    for (const companion of companions) {
      try {
        await window.electronAPI.movePath(companion.path, destDir);
      } catch (error) {
        console.warn('[translation] failed to move companion file', companion.path, error);
      }
    }

    state.project.tree = removeTreeNode(state.project.tree, sourcePath);
    repathOpenTabsForMove({ state, actions } as Context, sourcePath, newPath);
    await reloadDirectoryInTree({ state } as Context, destDir);
    if (oldParent !== destDir) {
      await reloadDirectoryInTree({ state } as Context, oldParent);
    }
    await ignoreSavedFileChange(newPath);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to move';
    if (message.includes('itself')) return { success: false, error: 'into_self' };
    if (message.includes('exists')) return { success: false, error: 'exists' };
    return { success: false, error: message };
  }
};

export const deleteExplorerItem = async (
  { state, actions }: Context,
  targetPath: string,
): Promise<{ success: boolean; error?: string }> => {
  if (!window.electronAPI?.deletePath) {
    return { success: false, error: 'Unavailable' };
  }

  const parentDir = getParentPath(targetPath);
  const tabsToClose = state.project.openTabs.filter((tab) => isPathUnder(tab.filePath, targetPath));

  const companions = await findCompanionTranslationFiles(targetPath);

  try {
    await window.electronAPI.deletePath(targetPath);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete',
    };
  }

  for (const companion of companions) {
    try {
      await window.electronAPI.deletePath(companion.path);
    } catch (error) {
      console.warn('[translation] failed to delete companion file', companion.path, error);
    }
  }

  state.project.tree = removeTreeNode(state.project.tree, targetPath);

  const pathsToClose = new Set(tabsToClose.map((tab) => tab.filePath));
  const remaining = state.project.openTabs.filter((tab) => !pathsToClose.has(tab.filePath));
  state.project.openTabs = remaining;

  if (state.project.activeTabPath && pathsToClose.has(state.project.activeTabPath)) {
    if (remaining.length === 0) {
      state.project.activeTabPath = null;
      window.writer?.overmindActions?.ui?.resetSourceEditor?.();
      await actions.editor.clearResource();
    } else {
      const nextTab = remaining[remaining.length - 1];
      await actions.project.switchTab({ filePath: nextTab.filePath });
    }
  }

  if (parentDir && parentDir !== '/') {
    await reloadDirectoryInTree({ state } as Context, parentDir);
  }

  return { success: true };
};

export const refreshProjectSchemaConfig = ({ state }: Context, bundle: ProjectBundle) => {
  state.project.config = bundle.config;
  state.project.projectSchemas = buildProjectSchemas(bundle.rootPath, bundle.config);

  if (window.writer) {
    window.writer.overmindActions?.editor?.clearProjectSchemas?.();
    registerDesktopSchemas([...getEnabledCatalogSchemas(), ...state.project.projectSchemas]);
  }
};

/** Refresh in-memory project config after a partial project-file patch. */
export const syncProjectFileConfig = ({ state }: Context, bundle: ProjectBundle) => {
  if (state.project.projectFilePath !== bundle.projectFilePath) return;
  state.project.config = bundle.config;
};
