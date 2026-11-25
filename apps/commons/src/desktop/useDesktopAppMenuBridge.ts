import { EXPLORER_OPEN_FOCUSED_EVENT } from '@src/desktop/explorer/explorerShortcuts';
import { openFindPanel } from '@src/desktop/desktopLeftPanelBridge';
import { redoDocumentEditor, undoDocumentEditor } from '@src/desktop/editorUndoRedo';
import { useActions } from '@src/overmind';
import { isDesktop } from '@src/types/desktop';
import { useEffect } from 'react';
import {
  dispatchPluginToolAction,
  isKnownPluginToolAction,
} from '../../../../packages/cwrc-leafwriter/src/plugins';

/** App-wide Electron menu shortcuts (registered once, survives route changes). */
export const useDesktopAppMenuBridge = () => {
  const { closeProject, openProject, openRecentProject } = useActions().project;
  const { notifyViaSnackbar } = useActions().ui;

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.onAppMenuAction) return;

    // Re-apply the persisted interface zoom (set via the settings slider,
    // stored by cwrc-leafwriter's uiZoom module under the same key).
    const storedUiZoom = Number(window.localStorage.getItem('leafWriterUiZoom'));
    if (Number.isFinite(storedUiZoom) && storedUiZoom > 0 && storedUiZoom !== 100) {
      window.electronAPI.setUiZoomFactor?.(storedUiZoom / 100);
    }

    const unsubscribeRecent = window.electronAPI.onOpenRecentProject?.((projectFilePath) => {
      void openRecentProject({ projectFilePath });
    });

    const unsubscribe = window.electronAPI.onAppMenuAction((action) => {
      if (action === 'open-project') {
        // With the file tree focused, Cmd+O opens the focused item rather than a project.
        const request = new CustomEvent(EXPLORER_OPEN_FOCUSED_EVENT, {
          detail: { handled: false },
        });
        window.dispatchEvent(request);
        if (!request.detail.handled) void openProject();
        return;
      }

      if (action === 'close-project') {
        void closeProject();
        return;
      }

      if (action === 'open-find') {
        openFindPanel();
        return;
      }

      if (action === 'undo') {
        void undoDocumentEditor();
        return;
      }

      if (action === 'redo') {
        void redoDocumentEditor();
        return;
      }

      if (action === 'refresh') {
        // Broadcast to whichever panels (translation pane, file explorer,
        // database viewer, …) currently have a refresh listener registered.
        window.dispatchEvent(new CustomEvent('desktop:refresh'));
        return;
      }

      if (isKnownPluginToolAction(action)) {
        void dispatchPluginToolAction(action, { notify: notifyViaSnackbar });
        return;
      }

      if (action === 'daozang-import.open' || action === 'kanripo-import.open') {
        notifyViaSnackbar(
          'That import plugin did not finish loading. Open Tools → Plugins to confirm it is enabled, then restart the app.',
        );
      }
    });

    void window.electronAPI.signalRendererReady?.();

    return () => {
      unsubscribeRecent?.();
      unsubscribe();
    };
  }, [closeProject, notifyViaSnackbar, openProject, openRecentProject]);
};
