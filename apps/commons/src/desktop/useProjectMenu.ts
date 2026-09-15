import { clearFindHighlights } from '@src/desktop/find/findEditorHighlights';
import { openFindPanel } from '@src/desktop/desktopLeftPanelBridge';
import { openApplicationSettings } from '@src/desktop/openApplicationSettings';
import { promptAndApplySchemaUpdate } from '@src/desktop/schemaUpdateCheck';
import { everythingIsUpToDate, gatherUpdateReport } from '@src/desktop/lookForUpdates';
import { leafwriterAtom } from '@src/jotai';
import { useActions, useAppState } from '@src/overmind';
import { isDesktop } from '@src/types/desktop';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mergeEditorBodyWithStoredHeader, stripTeiHeaderForVisualEditor } from './teiHeaderXml';

const openSettings = async (
  leafWriter: { showSettingsDialog: () => Promise<void> } | null,
  notify: (message: string) => void,
  openSettingsMessage: string,
) => {
  if (await openApplicationSettings()) return;

  if (leafWriter) {
    await leafWriter.showSettingsDialog();
    return;
  }

  if (window.writer) {
    window.writer.overmindActions.ui.openDialog({ type: 'settings' });
    return;
  }

  notify(openSettingsMessage);
};

const getEditorContent = async (
  leafWriter: { getContent: () => Promise<string | undefined> } | null,
  fallbackXml?: string,
) => {
  const content = leafWriter ? await leafWriter.getContent() : await window.writer?.getContent();
  if (!content || !isDesktop()) return content;
  if (window.writer?.overmindState?.ui?.editorViewMode === 'source') return content;

  const baseXml =
    window.__desktopStoredDocumentXml ??
    fallbackXml ??
    window.writer?.overmindState?.document?.xml ??
    content;
  return mergeEditorBodyWithStoredHeader(stripTeiHeaderForVisualEditor(content), baseXml);
};

export const useProjectMenu = () => {
  const { t } = useTranslation();
  const {
    closeTab,
    importDocuments,
    markTabDirty,
    newFile,
    promptCloseDirtyTab,
    refreshProjectSchemaConfig,
    saveActiveTab,
    saveActiveTabAs,
  } = useActions().project;
  const { setContentHasChanged } = useActions().editor;
  const {
    closeForegroundPopup: closeCommonsPopup,
    notifyViaSnackbar,
    openDialog,
  } = useActions().ui;
  const { activeTabPath, isProjectReady, openTabs, projectFilePath } = useAppState().project;
  const { contentHasChanged } = useAppState().editor;
  const [leafWriter] = useAtom(leafwriterAtom);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [timeMachineOpen, setTimeMachineOpen] = useState(false);

  const finalizeSavedDocument = useCallback(
    (content: string) => {
      setContentHasChanged(false);
      markTabDirty(false);
      leafWriter?.setContentHasChanged(false);
      window.__desktopStoredDocumentXml = content;
      window.writer?.overmindActions?.document?.setDocumentXml(content);
      window.writer?.overmindActions?.ui?.markSourceSaved?.(content);
      void window.writer?.overmindActions?.validator?.validate();
    },
    [leafWriter, markTabDirty, setContentHasChanged],
  );

  const saveCurrentDocument = useCallback(async () => {
    if (!isDesktop()) return;

    clearFindHighlights();

    const guard = await window.writer?.overmindActions?.ui?.guardSourceModeSave?.();
    if (guard && !guard.proceed) {
      if (guard.reverted) {
        notifyViaSnackbar(t('LWC.desktop.project.messages.reverted_to_valid_version'));
      }
      return;
    }

    const activeTab = openTabs.find((tab) => tab.filePath === activeTabPath);
    const content = await getEditorContent(leafWriter, activeTab?.content);
    if (!content) {
      notifyViaSnackbar(t('LWC.desktop.project.messages.open_xml_before_saving'));
      return;
    }

    const result = await saveActiveTab({ content });
    if (result.skipped) return;
    if (result.success) {
      finalizeSavedDocument(result.content ?? content);
      notifyViaSnackbar({
        message: t('LWC.desktop.project.document_saved'),
        options: { variant: 'success' },
      });
      return;
    }

    if (result.error) {
      notifyViaSnackbar({ message: result.error, options: { variant: 'error' } });
    }
  }, [
    activeTabPath,
    finalizeSavedDocument,
    leafWriter,
    notifyViaSnackbar,
    openTabs,
    saveActiveTab,
    t,
  ]);

  const saveCurrentDocumentAs = useCallback(async () => {
    if (!isDesktop()) return;

    clearFindHighlights();

    const guard = await window.writer?.overmindActions?.ui?.guardSourceModeSave?.();
    if (guard && !guard.proceed) {
      if (guard.reverted) {
        notifyViaSnackbar(t('LWC.desktop.project.messages.reverted_to_valid_version'));
      }
      return;
    }

    const activeTab = openTabs.find((tab) => tab.filePath === activeTabPath);
    const content = await getEditorContent(leafWriter, activeTab?.content);
    if (!content) {
      notifyViaSnackbar(t('LWC.desktop.project.messages.open_xml_before_saving'));
      return;
    }

    const result = await saveActiveTabAs({ content });
    if (result.cancelled) return;

    if (result.success) {
      finalizeSavedDocument(result.content ?? content);
      notifyViaSnackbar({
        message: t('LWC.desktop.project.document_saved'),
        options: { variant: 'success' },
      });
      return;
    }

    if (result.error) {
      notifyViaSnackbar({ message: result.error, options: { variant: 'error' } });
    }
  }, [
    activeTabPath,
    finalizeSavedDocument,
    leafWriter,
    notifyViaSnackbar,
    openTabs,
    saveActiveTabAs,
    t,
  ]);

  const closeCurrentTab = useCallback(async () => {
    if (!activeTabPath) return;

    clearFindHighlights();
    const tab = openTabs.find((item) => item.filePath === activeTabPath);
    if (!tab) return;

    const content = await getEditorContent(leafWriter, tab.content);
    const isDirty = contentHasChanged || tab.dirty;

    if (isDirty) {
      const result = await promptCloseDirtyTab({
        tab: {
          content: tab.content,
          filePath: tab.filePath,
          filename: tab.filename,
          isTemp: tab.isTemp,
        },
        contentOverride: content ?? tab.content,
      });
      if (result === 'abort' || result === 'handled') return;
    }

    await closeTab({ content, filePath: activeTabPath });
  }, [activeTabPath, closeTab, contentHasChanged, leafWriter, openTabs, promptCloseDirtyTab]);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.onAppMenuAction) return;

    const unsubscribe = window.electronAPI.onAppMenuAction((action) => {
      if (action === 'new-file') {
        void newFile();
        return;
      }

      if (action === 'import-documents') {
        void importDocuments();
        return;
      }

      if (action === 'wikisource-import') {
        if (!isProjectReady) {
          notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
          return;
        }
        openDialog({ type: 'wikisourceImport' });
        return;
      }

      if (action === 'save') {
        void saveCurrentDocument();
        return;
      }

      if (action === 'save-as') {
        void saveCurrentDocumentAs();
        return;
      }

      if (action === 'close-tab') {
        void closeCurrentTab();
        return;
      }

      if (action === 'export-document') {
        if (!activeTabPath) {
          notifyViaSnackbar(t('LWC.desktop.project.messages.open_xml_before_saving'));
          return;
        }

        openDialog({ type: 'export', props: { maxWidth: 'sm' } });
        return;
      }

      if (action === 'open-about') {
        setAboutOpen(true);
        return;
      }

      if (action === 'open-time-machine') {
        if (!isProjectReady || !projectFilePath) {
          notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
          return;
        }

        setTimeMachineOpen(true);
        return;
      }

      if (action === 'open-settings') {
        void openSettings(
          leafWriter,
          (message) => notifyViaSnackbar(message),
          t('LWC.desktop.could_not_open_settings'),
        );
        return;
      }

      if (action === 'look-for-updates') {
        void (async () => {
          notifyViaSnackbar(t('LWC.desktop.project.checking_for_updates'));

          const api = window.electronAPI;
          if (!api) {
            notifyViaSnackbar(t('LWC.desktop.project.update_check_unavailable'));
            return;
          }

          const report = await gatherUpdateReport(api, {
            projectFilePath: isProjectReady ? projectFilePath : null,
          });

          if (everythingIsUpToDate(report)) {
            notifyViaSnackbar(t('LWC.desktop.project.everything_up_to_date'));
            return;
          }

          const app = report.app;
          if (app?.status === 'updateAvailable') {
            notifyViaSnackbar(
              t('LWC.desktop.project.app_update_downloading', { version: app.version }),
            );
          } else if (app?.status === 'error') {
            await api.showNativeMessageBox?.({
              type: 'warning',
              title: t('LWC.desktop.project.app_update_check_failed_title'),
              message: t('LWC.desktop.project.app_update_check_failed', {
                error: app.message,
              }),
              buttons: [t('LWC.desktop.project.dialogs.ok_button')],
              defaultId: 0,
            });
          }

          if (report.authority?.enabled && report.authority.updateAvailable) {
            notifyViaSnackbar(
              report.authorityApplied?.ok
                ? t('LWC.desktop.project.authority_updated')
                : (report.authorityApplied?.error ??
                    t('LWC.desktop.project.authority_update_failed')),
            );
          }

          if (report.pluginsApplied?.updated.length) {
            notifyViaSnackbar(
              t('LWC.desktop.project.plugin_updates_applied', {
                count: report.pluginsApplied.updated.length,
              }),
            );
          }
          if (report.pluginsApplied?.failed.length) {
            notifyViaSnackbar(
              t('LWC.desktop.project.plugin_updates_failed', {
                count: report.pluginsApplied.failed.length,
              }),
            );
          }

          if (report.schema?.status === 'updateAvailable' && isProjectReady && projectFilePath) {
            await promptAndApplySchemaUpdate(projectFilePath, report.schema, {
              notify: (message) => notifyViaSnackbar(message),
              onBundleUpdated: (bundle) => refreshProjectSchemaConfig(bundle),
            });
          }
        })();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    activeTabPath,
    isProjectReady,
    importDocuments,
    leafWriter,
    newFile,
    notifyViaSnackbar,
    openDialog,
    projectFilePath,
    closeCurrentTab,
    refreshProjectSchemaConfig,
    saveCurrentDocument,
    saveCurrentDocumentAs,
    t,
  ]);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.onWikisourceImportOrder) return;
    const unsubscribe = window.electronAPI.onWikisourceImportOrder((order) => {
      if (!isProjectReady) {
        notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
        return;
      }
      openDialog({
        type: 'wikisourceImport',
        props: { initialUrl: order.url, importScope: order.scope, autoRun: true },
      });
    });
    return () => unsubscribe();
  }, [isProjectReady, notifyViaSnackbar, openDialog, t]);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.onKanripoImportOrder) return;
    const unsubscribe = window.electronAPI.onKanripoImportOrder((order) => {
      if (!isProjectReady) {
        notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
        return;
      }
      openDialog({
        type: 'kanripoImport',
        props: {
          initialKrId: order.kr_id,
          initialImportScope: order.scope,
          initialJuan: order.juan ?? order.loc?.split('_').slice(1).join('_') ?? '',
          initialUrl: order.url,
        },
      });
    });
    return () => unsubscribe();
  }, [isProjectReady, notifyViaSnackbar, openDialog, t]);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.onBdrcImportOrder) return;
    const unsubscribe = window.electronAPI.onBdrcImportOrder((order) => {
      if (!isProjectReady) {
        notifyViaSnackbar(t('LWC.desktop.project.messages.open_project_first'));
        return;
      }
      openDialog({
        type: 'bdrcImport',
        props: { initialRef: order.etext_id || order.url, autoRun: true },
      });
    });
    return () => unsubscribe();
  }, [isProjectReady, notifyViaSnackbar, openDialog, t]);

  const onKeydownHandle = useCallback(
    async (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        let closed = false;
        if (leafWriter) {
          closed = leafWriter.closeForegroundPopup();
        } else if (window.writer) {
          closed = window.writer.overmindActions.ui.closeForegroundPopup();
        }
        if (!closed) {
          closed = closeCommonsPopup();
        }

        if (closed) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        openFindPanel();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        event.stopPropagation();
        await openSettings(
          leafWriter,
          (message) => notifyViaSnackbar(message),
          t('LWC.desktop.could_not_open_settings'),
        );
        return;
      }

      // File menu shortcuts (Save, Save As, Open Project, New File) are handled by the
      // Electron application menu accelerators via onAppMenuAction. Handling them here too
      // caused duplicate actions (e.g. Cmd+O firing openProject twice, Cmd+S racing saves).
    },
    [closeCommonsPopup, leafWriter, notifyViaSnackbar, t],
  );

  return { aboutOpen, onKeydownHandle, setAboutOpen, setTimeMachineOpen, timeMachineOpen };
};
