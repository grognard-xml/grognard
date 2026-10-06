import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { Divider, IconButton, Menu, MenuItem, Paper, Stack, Tooltip } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useActions } from '../../overmind';
import {
  prettyPrintSourceEditor,
  runSourceEditorCommand,
  type SourceEditorCommand,
} from '../../sourceEditor/sourceEditorCommands';

const buttonSx = { width: 34, height: 34, borderRadius: 1 };

/** Toolbar shown above the Monaco editor in Source mode. */
export const SourceToolbar = () => {
  const { t } = useTranslation();
  const { notifyViaSnackbar } = useActions().ui;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const handlePrettyPrint = () => {
    const result = prettyPrintSourceEditor();
    if (result === 'unavailable') return;
    const message = {
      ok: t('LW.sourceToolbar.pretty_print_done'),
      unchanged: t('LW.sourceToolbar.pretty_print_unchanged'),
      malformed: t('LW.sourceToolbar.pretty_print_malformed'),
    }[result];
    notifyViaSnackbar({
      message,
      options: { variant: result === 'malformed' ? 'warning' : 'info' },
    });
  };

  const collapse = (command: SourceEditorCommand) => {
    setMenuAnchor(null);
    runSourceEditorCommand(command);
  };

  return (
    <Paper
      elevation={5}
      square
      sx={[
        { width: '100%', backgroundColor: '#f5f5f5' },
        (theme) =>
          theme.applyStyles('dark', { backgroundColor: theme.vars.palette.background.paper }),
      ]}
    >
      <Stack direction="row" alignItems="center" gap={0.25} px={0.5} py={0.25}>
        <Tooltip title={t('LW.sourceToolbar.pretty_print_tooltip')} enterDelay={800}>
          <IconButton
            aria-label={t('LW.sourceToolbar.pretty_print')}
            onClick={handlePrettyPrint}
            onMouseDown={(event) => event.preventDefault()}
            size="small"
            sx={buttonSx}
          >
            <FormatAlignLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Divider flexItem orientation="vertical" sx={{ mx: 0.5 }} />
        <Tooltip title={t('LW.sourceToolbar.collapse_all_tooltip')} enterDelay={800}>
          <IconButton
            aria-label={t('LW.sourceToolbar.collapse_all')}
            onClick={() => collapse('foldAll')}
            onMouseDown={(event) => event.preventDefault()}
            size="small"
            sx={buttonSx}
          >
            <UnfoldLessIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('LW.sourceToolbar.collapse_menu')} enterDelay={800}>
          <IconButton
            aria-label={t('LW.sourceToolbar.collapse_menu')}
            aria-haspopup="menu"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
            onMouseDown={(event) => event.preventDefault()}
            size="small"
            sx={{ ...buttonSx, width: 22, ml: -0.5 }}
          >
            <ArrowDropDownIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('LW.sourceToolbar.expand_all_tooltip')} enterDelay={800}>
          <IconButton
            aria-label={t('LW.sourceToolbar.expand_all')}
            onClick={() => collapse('unfoldAll')}
            onMouseDown={(event) => event.preventDefault()}
            size="small"
            sx={buttonSx}
          >
            <UnfoldMoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem dense onClick={() => collapse('foldParagraphs')}>
          {t('LW.sourceToolbar.collapse_paragraphs')}
        </MenuItem>
        <MenuItem dense onClick={() => collapse('foldDivisions')}>
          {t('LW.sourceToolbar.collapse_divisions')}
        </MenuItem>
        <MenuItem dense onClick={() => collapse('foldHeader')}>
          {t('LW.sourceToolbar.collapse_header')}
        </MenuItem>
      </Menu>
    </Paper>
  );
};
