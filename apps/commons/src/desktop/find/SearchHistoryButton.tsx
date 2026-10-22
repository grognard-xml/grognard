import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import {
  Box,
  Chip,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SearchHistoryItem {
  /** What was searched. */
  primary: string;
  /** What it was replaced with, when that is part of the entry. */
  replacement?: string;
  /** Short labels for the options and scope that come back with the entry. */
  chips: string[];
}

/** The pop-down of earlier searches. Choosing one hands its index back; nothing is run here. */
export const SearchHistoryButton = ({
  items,
  onSelect,
  onRemove,
  onClear,
  label,
}: {
  items: SearchHistoryItem[];
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  label: string;
}) => {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  return (
    <>
      <Tooltip title={label}>
        <span>
          <IconButton
            size="small"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={Boolean(anchor)}
            onClick={(event) => setAnchor(event.currentTarget)}
            edge="end"
          >
            <HistoryIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{ paper: { sx: { maxHeight: 360, width: 340, maxWidth: '90vw' } } }}
      >
        {items.length === 0 && (
          <MenuItem disabled>
            {t('LWC.desktop.sidebar.find.history_empty', { defaultValue: 'No earlier searches' })}
          </MenuItem>
        )}
        {items.map((item, index) => (
          <MenuItem
            key={`${index}-${item.primary}`}
            onClick={() => {
              close();
              onSelect(index);
            }}
            sx={{ alignItems: 'flex-start', gap: 0.5, whiteSpace: 'normal' }}
          >
            <ListItemText
              primary={item.primary}
              secondary={
                <>
                  {item.replacement !== undefined && (
                    <Box component="span" sx={{ display: 'block' }}>
                      {'→ '}
                      {item.replacement === ''
                        ? t('LWC.desktop.sidebar.find.history_empty_replacement', {
                            defaultValue: '(nothing: delete)',
                          })
                        : item.replacement}
                    </Box>
                  )}
                  {item.chips.length > 0 && (
                    <Box
                      component="span"
                      sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}
                    >
                      {item.chips.map((chip) => (
                        <Chip key={chip} label={chip} size="small" variant="outlined" />
                      ))}
                    </Box>
                  )}
                </>
              }
              slotProps={{
                primary: {
                  sx: { fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-all' },
                },
                secondary: {
                  component: 'div',
                  sx: { fontSize: '0.75rem', wordBreak: 'break-all' },
                },
              }}
              sx={{ m: 0, minWidth: 0 }}
            />
            <Tooltip
              title={t('LWC.desktop.sidebar.find.history_remove', {
                defaultValue: 'Remove from history',
              })}
            >
              <IconButton
                size="small"
                aria-label={t('LWC.desktop.sidebar.find.history_remove', {
                  defaultValue: 'Remove from history',
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(index);
                }}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </MenuItem>
        ))}
        {items.length > 0 && <Divider />}
        {items.length > 0 && (
          <MenuItem
            onClick={() => {
              close();
              onClear();
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('LWC.desktop.sidebar.find.history_clear', { defaultValue: 'Clear history' })}
            </Typography>
          </MenuItem>
        )}
      </Menu>
    </>
  );
};
