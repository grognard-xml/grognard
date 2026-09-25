import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, MenuItem, Select, TextField, Tooltip } from '@mui/material';
import { emptyLeafSlot, type ComposerSlot } from '../../utilities/composerTree';
import { IDS_OPERATORS, type IdsOperator } from '../../utilities/kageCompose';

/**
 * Phase D (plugins/composer-visual-redesign.md §4): recursive editor for one
 * `ComposerSlot`. A leaf is a plain text field (today's behaviour); clicking
 * "Compose this part" turns it into a `nested` slot with its own operator
 * picker and two child editors, indented, to any depth - the inline
 * alternative to saving a sub-part, closing the dialog, and reopening it to
 * reference the saved id.
 */
export const SlotEditor = ({
  slot,
  onChange,
  label,
}: {
  slot: ComposerSlot;
  onChange: (slot: ComposerSlot) => void;
  label: string;
}) => {
  if (slot.kind === 'leaf') {
    return (
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <TextField
          label={label}
          size="small"
          value={slot.input}
          onChange={(e) => onChange({ kind: 'leaf', input: e.target.value })}
          fullWidth
        />
        <Tooltip title="Compose this part">
          <IconButton
            size="small"
            onClick={() =>
              onChange({
                kind: 'nested',
                operator: '⿰',
                first: emptyLeafSlot(),
                second: emptyLeafSlot(),
              })
            }
          >
            <AddCircleOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        pl: 1.5,
        borderLeft: '2px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <Select
          value={slot.operator}
          onChange={(e) => onChange({ ...slot, operator: e.target.value as IdsOperator })}
          size="small"
        >
          {IDS_OPERATORS.map(({ operator: op, label: opLabel }) => (
            <MenuItem key={op} value={op}>
              {op} {opLabel}
            </MenuItem>
          ))}
        </Select>
        <Tooltip title="Flatten back to a single field">
          <IconButton size="small" onClick={() => onChange(emptyLeafSlot())}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <SlotEditor
        slot={slot.first}
        onChange={(next) => onChange({ ...slot, first: next })}
        label="First component"
      />
      <SlotEditor
        slot={slot.second}
        onChange={(next) => onChange({ ...slot, second: next })}
        label="Second component"
      />
    </Box>
  );
};

export default SlotEditor;
