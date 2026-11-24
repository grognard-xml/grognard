import { Box, Link, Paper, Stack } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import pck from '../../../package.json';
import { PrivacyDialog } from '../../dialogs/privacy-dialog';
import { useAppState } from '../../overmind';
import { AuthorityLoadIndicator } from './AuthorityLoadIndicator';
import { AiRunIndicator } from './AiRunIndicator';
import { AppUpdateIndicator } from './AppUpdateIndicator';
import { BulkSyncIndicator } from './BulkSyncIndicator';
import { DatabaseJobIndicator } from './DatabaseJobIndicator';
import { EntityIndexIndicator } from './EntityIndexIndicator';
import { ValdidationErrors } from './ValdidationErrors';
import { Schema } from './schema';
import { EditorZoomControls } from './sourceView/EditorZoomControls';
import { SourceView } from './sourceView';

const isDesktopApp = () =>
  typeof window !== 'undefined' && !!(window as Window & { electronAPI?: unknown }).electronAPI;

export const BottomBar = () => {
  const { enableXmlEditing, isReadonly } = useAppState().editor;
  const { validationErrors } = useAppState().validator;
  const { t } = useTranslation();
  const version = pck.version;
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const desktop = isDesktopApp();

  return (
    <Paper elevation={0} square sx={{ width: '100%', backgroundColor: 'background.paper' }}>
      {!desktop && (
        <PrivacyDialog onClose={() => setPrivacyDialogOpen(false)} open={privacyDialogOpen} />
      )}
      <Stack direction="row" alignItems="center" spacing={1} px={1}>
        {!isReadonly && (
          <>
            <Schema />
            {enableXmlEditing && <SourceView />}
            <EditorZoomControls />
          </>
        )}

        {validationErrors > 0 && !isReadonly && enableXmlEditing && <ValdidationErrors />}

        <Box flexGrow={1} />

        <AuthorityLoadIndicator />
        <AiRunIndicator />
        <EntityIndexIndicator />
        <BulkSyncIndicator />
        <DatabaseJobIndicator />
        <AppUpdateIndicator />

        {!desktop && (
          <>
            <Link
              component="button"
              color="textSecondary"
              onClick={() => setPrivacyDialogOpen(true)}
              variant="caption"
            >
              {t('LW.commons.Privacy Policy')}
            </Link>

            <Link
              color="textSecondary"
              variant="caption"
              href="https://github.com/grognard-xml/grognard/issues/new"
              target="_blank"
            >
              {t('LW.Bugs')} / {t('LW.Requests')}
            </Link>

            <Link
              color="textSecondary"
              variant="caption"
              href={pck.homepage}
              rel="noopener"
              target="_blank"
              title="Repository"
            >
              {`v${version}`}
            </Link>
          </>
        )}
      </Stack>
    </Paper>
  );
};
