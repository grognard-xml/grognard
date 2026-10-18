import { Box } from '@mui/material';
import {
  DocumentLoadingCover,
  useCommonsUiBridge,
  useEntityDatabaseLifecycle,
  useLspProjectBridge,
  useNativeDialogBridge,
  clearHostDialogBridge,
  registerHostDialogBridge,
} from '@src/desktop';
import { UserNamePromptDialog } from '@src/desktop/UserNamePromptDialog';
import { Page } from '@src/layouts';
import { leafwriterAtom } from '@src/jotai';
import { useActions, useAppState } from '@src/overmind';
import { isDesktop } from '@src/types/desktop';
import { useAtomValue } from 'jotai';
import { useEffect, useLayoutEffect } from 'react';
import { ImportJobPanel } from '../../../../../packages/cwrc-leafwriter/src/importJobs/ImportJobPanel';
import { ProjectEditor } from './ProjectEditor';

export const ProjectEditPage = () => {
  const { setPage, notifyViaSnackbar, openDialog } = useActions().ui;
  const { restoreLastProject, saveWorkspaceSession } = useActions().project;
  const { activeTabPath, isProjectReady, openTabs, projectFilePath } = useAppState().project;

  const leafWriter = useAtomValue(leafwriterAtom);

  useNativeDialogBridge();
  useCommonsUiBridge();
  useLspProjectBridge();
  useEntityDatabaseLifecycle();

  useLayoutEffect(() => {
    registerHostDialogBridge(openDialog, notifyViaSnackbar);
    return () => clearHostDialogBridge();
  }, [notifyViaSnackbar, openDialog]);

  useEffect(() => {
    setPage('project');
  }, [setPage]);

  useEffect(() => {
    if (!isDesktop()) return;
    void restoreLastProject();
  }, [restoreLastProject]);

  useEffect(() => {
    if (!isDesktop() || !isProjectReady || !projectFilePath) return;

    void saveWorkspaceSession();

    return () => {
      void saveWorkspaceSession();
    };
  }, [activeTabPath, isProjectReady, openTabs, projectFilePath, saveWorkspaceSession]);

  useEffect(() => {
    if (!isDesktop() || !isProjectReady) return;

    const flush = () => {
      void saveWorkspaceSession();
    };

    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);

    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [isProjectReady, saveWorkspaceSession]);

  return (
    <Page>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - var(--titlebar-height, 0px))',
        }}
      >
        <UserNamePromptDialog />
        {isDesktop() && !isProjectReady ? (
          <DocumentLoadingCover absolute={false} visible />
        ) : (
          <ProjectEditor />
        )}
      </Box>
      {/* The editor's own copy of the panel only exists once a file is open. */}
      {isDesktop() && !leafWriter && <ImportJobPanel />}
    </Page>
  );
};
