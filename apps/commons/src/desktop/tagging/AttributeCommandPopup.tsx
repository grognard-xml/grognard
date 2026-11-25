import {
  Box,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { SchemaAttributeDetail } from './attributeSuggestions';
import { useClampedPopupPosition } from './clampPopupPosition';

export interface AttributeCommandPopupProps {
  anchor: { left: number; top: number } | null;
  focusedField: 'name' | 'value';
  highlightedIndex: number;
  nameFilter: string;
  /** The name box shows a remembered attribute; select it so typing replaces it. */
  nameIsPrefill: boolean;
  onClose: () => void;
  onFocusedFieldChange: (field: 'name' | 'value') => void;
  onHighlightChange: (index: number) => void;
  onNameFilterChange: (value: string) => void;
  onPopupKeyDown: (event: React.KeyboardEvent) => void;
  onValueFilterChange: (value: string) => void;
  open: boolean;
  schemaAttributes: SchemaAttributeDetail[];
  tagName: string;
  valueFilter: string;
  /** The value box shows the attribute's current value; select it so typing replaces it. */
  valueIsPrefill: boolean;
  valueHighlightedIndex: number;
  valueSuggestions: string[];
  /** Matching values not listed; type more to narrow them. */
  valueSuggestionsHidden: number;
}

/** Keep the keyboard-selected row visible in a scrolling list. */
const scrollIntoViewIfSelected = (element: HTMLElement | null) => {
  element?.scrollIntoView?.({ block: 'nearest' });
};

export const AttributeCommandPopup = ({
  anchor,
  focusedField,
  highlightedIndex,
  nameFilter,
  nameIsPrefill,
  onClose,
  onFocusedFieldChange,
  onHighlightChange,
  onNameFilterChange,
  onPopupKeyDown,
  onValueFilterChange,
  open,
  schemaAttributes,
  tagName,
  valueFilter,
  valueIsPrefill,
  valueHighlightedIndex,
  valueSuggestions,
  valueSuggestionsHidden,
}: AttributeCommandPopupProps) => {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const valueInputRef = useRef<HTMLInputElement>(null);
  const {
    ref: popupRef,
    left,
    top,
  } = useClampedPopupPosition(anchor, open, [
    focusedField,
    highlightedIndex,
    nameFilter,
    schemaAttributes.length,
    valueFilter,
    valueSuggestions.length,
  ]);

  useLayoutEffect(() => {
    if (!open) return;
    if (focusedField === 'value') {
      valueInputRef.current?.focus();
    } else {
      nameInputRef.current?.focus();
    }
  }, [focusedField, open]);

  useEffect(() => {
    if (open && focusedField === 'name' && nameIsPrefill) nameInputRef.current?.select();
  }, [focusedField, nameFilter, nameIsPrefill, open]);

  useEffect(() => {
    if (open && focusedField === 'value' && valueIsPrefill) valueInputRef.current?.select();
  }, [focusedField, open, valueFilter, valueIsPrefill]);

  if (!open || !anchor) return null;

  return (
    <Paper
      ref={popupRef}
      elevation={8}
      onKeyDown={onPopupKeyDown}
      sx={{
        position: 'fixed',
        left,
        top,
        zIndex: 1400,
        width: 280,
        maxHeight: 360,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
        <Typography variant="subtitle2">Add attribute</Typography>
        <Typography variant="caption" color="text.secondary">
          on &lt;{tagName}&gt; — Tab for value, Enter to commit
        </Typography>
      </Box>

      <Box sx={{ px: 1.5, pb: 1 }}>
        <TextField
          inputRef={nameInputRef}
          fullWidth
          size="small"
          label="Attribute name"
          placeholder="Filter attributes..."
          value={nameFilter}
          onChange={(event) => onNameFilterChange(event.target.value)}
          onFocus={(event) => {
            onFocusedFieldChange('name');
            if (nameIsPrefill) event.target.select();
          }}
          autoComplete="off"
        />
        <TextField
          inputRef={valueInputRef}
          fullWidth
          size="small"
          label="Value"
          placeholder="Attribute value"
          value={valueFilter}
          onChange={(event) => onValueFilterChange(event.target.value)}
          onFocus={(event) => {
            onFocusedFieldChange('value');
            if (valueIsPrefill) event.target.select();
          }}
          sx={{ mt: 1 }}
          autoComplete="off"
        />
      </Box>

      {focusedField === 'name' && schemaAttributes.length > 0 ? (
        <List dense sx={{ flex: 1, overflow: 'auto', py: 0 }}>
          {schemaAttributes.map((attr, index) => (
            <ListItemButton
              key={attr.name}
              disabled={Boolean(attr.invalid)}
              ref={index === highlightedIndex ? scrollIntoViewIfSelected : undefined}
              selected={index === highlightedIndex}
              onClick={() => {
                if (attr.invalid) return;
                onNameFilterChange(attr.name);
                onHighlightChange(index);
                onFocusedFieldChange('value');
              }}
            >
              <ListItemText
                primary={attr.name}
                secondary={
                  attr.invalid
                    ? 'Not valid here'
                    : attr.fullName && attr.fullName !== attr.name
                      ? attr.fullName
                      : undefined
                }
              />
            </ListItemButton>
          ))}
        </List>
      ) : null}

      {focusedField === 'value' && valueSuggestions.length > 0 ? (
        <List dense sx={{ flex: 1, overflow: 'auto', py: 0 }}>
          {valueSuggestions.map((value, index) => (
            <ListItemButton
              key={value}
              ref={index === valueHighlightedIndex ? scrollIntoViewIfSelected : undefined}
              selected={index === valueHighlightedIndex}
              onClick={() => onValueFilterChange(value)}
            >
              <ListItemText primary={value} />
            </ListItemButton>
          ))}
          {valueSuggestionsHidden > 0 ? (
            <Typography color="text.secondary" sx={{ px: 2, py: 0.5 }} variant="caption">
              +{valueSuggestionsHidden} more — keep typing to narrow
            </Typography>
          ) : null}
        </List>
      ) : null}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, p: 1.5, pt: 0 }}>
        <Typography
          component="button"
          type="button"
          variant="caption"
          onClick={onClose}
          sx={{ border: 0, background: 'none', cursor: 'pointer', color: 'text.secondary' }}
        >
          Cancel (Esc)
        </Typography>
      </Box>
    </Paper>
  );
};
