import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import {
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Tooltip,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SEARCH_SCOPE_LABEL_KEYS, type SearchScope } from './searchScope';

interface ScopeFieldsProps {
  customPath: string;
  /** Folder the custom scope starts in: the folder of the open file. */
  defaultFolder?: string;
  onCustomPathChange: (value: string) => void;
  onEnter?: () => void;
  onScopeChange: (scope: SearchScope) => void;
  scope: SearchScope;
  scopeLabelId: string;
}

/** Parent folder of a file path, for either path separator. */
export const folderOfFile = (filePath?: string | null): string => {
  if (!filePath) return '';
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index > 0 ? filePath.slice(0, index) : '';
};

export const ScopeFields = ({
  scope,
  onScopeChange,
  customPath,
  defaultFolder = '',
  onCustomPathChange,
  onEnter,
  scopeLabelId,
}: ScopeFieldsProps) => {
  const { t } = useTranslation();
  const canBrowse = typeof window.electronAPI?.pickSearchFolder === 'function';

  const handleScopeChange = (next: SearchScope) => {
    onScopeChange(next);
    if (next === 'custom' && !customPath.trim() && defaultFolder) {
      onCustomPathChange(defaultFolder);
    }
  };

  const handleBrowse = async () => {
    const picked = await window.electronAPI?.pickSearchFolder?.(
      customPath.trim() || defaultFolder || undefined,
    );
    if (picked) onCustomPathChange(picked);
  };

  return (
    <>
      <FormControl fullWidth size="small">
        <InputLabel id={scopeLabelId}>{t('LWC.desktop.scope_fields.scope')}</InputLabel>
        <Select
          labelId={scopeLabelId}
          label={t('LWC.desktop.scope_fields.scope')}
          value={scope}
          onChange={(event) => handleScopeChange(event.target.value as SearchScope)}
          sx={{ fontSize: '0.8125rem' }}
        >
          {(Object.keys(SEARCH_SCOPE_LABEL_KEYS) as SearchScope[]).map((value) => (
            <MenuItem key={value} value={value} sx={{ fontSize: '0.8125rem' }}>
              {t(SEARCH_SCOPE_LABEL_KEYS[value])}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {scope === 'custom' && (
        <TextField
          fullWidth
          size="small"
          placeholder={t('LWC.desktop.scope_fields.folder_placeholder')}
          value={customPath}
          onChange={(event) => onCustomPathChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEnter?.();
          }}
          slotProps={{
            input: {
              sx: { fontSize: '0.8125rem' },
              endAdornment: canBrowse ? (
                <InputAdornment position="end">
                  <Tooltip title={t('LWC.desktop.scope_fields.browse_folder')}>
                    <IconButton
                      aria-label={t('LWC.desktop.scope_fields.browse_folder')}
                      edge="end"
                      onClick={() => void handleBrowse()}
                      size="small"
                      sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                    >
                      <FolderOpenOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
      )}
    </>
  );
};
