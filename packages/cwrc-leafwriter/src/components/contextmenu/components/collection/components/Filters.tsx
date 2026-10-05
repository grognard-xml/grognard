import SearchIcon from '@mui/icons-material/Search';
import { Box, InputBase, Stack, ToggleButton, Tooltip, useTheme } from '@mui/material';
import { useAtom } from 'jotai';
import { debounce } from 'lodash';
import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../../../../icons';
import { showOnlyValidAtom } from '../../../store';

interface FilterProps {
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onQuery: (query: string) => void;
}

export const Filters = ({ onKeyDown, onQuery }: FilterProps) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const [onlyValid, setOnlyValid] = useAtom(showOnlyValidAtom);

  const [query, setQuery] = useState('');

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    handleChangeDebounce(event.target.value);
  };

  const handleChangeDebounce = useMemo(
    () => debounce((_query: string) => onQuery(_query), 200, { trailing: true }),
    // Built once: re-creating the debounced function would reset its timer on
    // every render, so the filter would never settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const toggleInvalid = () => setOnlyValid(!onlyValid);

  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      position="relative"
      width="100%"
      borderBottom={2}
      sx={[
        {
          backgroundColor: `rgba(${theme.vars.palette.common.white}/ 0.02)`,
          borderColor: `rgba(${theme.vars.palette.common.black}/ 0.02)`,
          transition: theme.transitions.create('border'),
          '&:hover': {
            borderColor: theme.vars.palette.primary.mainChannel,
          },
        },
        query === '' && {
          '&:hover': {
            backgroundColor: `rgba(${theme.vars.palette.primary.mainChannel}/ 0.5)`,
          },
        },
        (theme) =>
          theme.applyStyles('dark', {
            backgroundColor: `rgba(${theme.vars.palette.common.black}/ 0.15)`,
            borderColor: `rgba(${theme.vars.palette.common.black}/ 0.15)`,
          }),
      ]}
    >
      <Box
        position="absolute"
        display="flex"
        alignItems="center"
        justifyContent="center"
        height="100%"
        py={1}
        px={0}
        sx={[
          { transition: theme.transitions.create('color'), pointerEvents: 'none' },
          query === '' && { color: theme.vars.palette.primary.mainChannel },
        ]}
      >
        <SearchIcon fontSize="small" />
      </Box>
      <InputBase
        autoFocus
        inputProps={{ 'aria-label': 'search' }}
        onChange={handleQueryChange}
        onKeyDown={onKeyDown}
        placeholder={t('LW.commons.search').toString()}
        sx={[
          {
            width: '100%',
            fontSize: '0.875rem',
            '& .MuiInputBase-input': {
              py: 0.75,
              pr: 0.75,
              paddingLeft: `calc(1em + ${theme.spacing(2)})`,
            },
          },
          query === '' && { color: theme.vars.palette.primary.mainChannel },
        ]}
        value={query}
      />
      <Tooltip
        slotProps={{ tooltip: { sx: { textTransform: 'capitalize' } } }}
        title={t('LW.show only valid tags')}
      >
        <ToggleButton
          onChange={toggleInvalid}
          selected={onlyValid}
          size="small"
          sx={[
            {
              width: 26,
              height: 26,
              margin: 0.375,
              borderRadius: 0.5,
              border: 'none',
              color: theme.vars.palette.text.disabled,
            },
            onlyValid && { color: theme.vars.palette.primary.mainChannel },
          ]}
          value={onlyValid}
        >
          <Icon name="validate" fontSize="inherit" />
        </ToggleButton>
      </Tooltip>
    </Stack>
  );
};
