import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, TextField, Tooltip } from '@mui/material';
import { emptyLeafSlot, flattenNestedSlot, type ComposerSlot } from '../../utilities/composerTree';
import { IDS_OPERATORS, type IdsOperator } from '../../utilities/kageCompose';
import { LayoutGlyph } from './LayoutGlyph';

/** Names spoken by the text fields. The position in the square is the
 * label, so "Left" means the left box of a left/right layout. */
const PART_NAMES: Record<IdsOperator, string[]> = {
  '⿰': ['Left', 'Right'],
  '⿱': ['Above', 'Below'],
  '⿲': ['Left', 'Middle', 'Right'],
  '⿳': ['Top', 'Middle', 'Bottom'],
  '⿴': ['Surround', 'Inside'],
  '⿵': ['Surround from above', 'Inside'],
  '⿶': ['Surround from below', 'Inside'],
  '⿷': ['Surround from left', 'Inside'],
  '⿸': ['Upper-left surround', 'Inside'],
  '⿹': ['Upper-right surround', 'Inside'],
  '⿺': ['Lower-left surround', 'Inside'],
  '⿻': ['Back', 'Front'],
};

const partName = (operator: IdsOperator, index: number): string =>
  PART_NAMES[operator][index] ?? `Part ${index + 1}`;

const pathsEqual = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((n, i) => n === b[i]);

const ORANGE = 'warning.main';

export const LayoutPalette = ({
  activeOperator,
  onPick,
}: {
  /** The layout of the region that is selected, so its icon looks pressed.
   * Null when a plain text field is selected: no layout icon is that field. */
  activeOperator: IdsOperator | null;
  onPick: (operator: IdsOperator) => void;
}) => (
  <Box
    role="toolbar"
    aria-label="Layouts"
    sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, width: 280 }}
  >
    {IDS_OPERATORS.map(({ operator, label }) => {
      const pressed = operator === activeOperator;
      return (
        <Tooltip key={operator} title={label}>
          <Box
            component="button"
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            onClick={() => onPick(operator)}
            sx={{
              width: 32,
              height: 32,
              p: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'text.primary',
              bgcolor: pressed ? 'action.selected' : 'background.paper',
              border: '1px solid',
              borderColor: pressed ? ORANGE : 'divider',
              borderRadius: 0.5,
            }}
          >
            <LayoutGlyph operator={operator} />
          </Box>
        </Tooltip>
      );
    })}
  </Box>
);

const dashedSplit = (edge: 'left' | 'top') =>
  edge === 'left'
    ? { borderLeft: '1px dashed', borderColor: 'text.disabled' }
    : { borderTop: '1px dashed', borderColor: 'text.disabled' };

/**
 * One region of the square: either the whole composition or a layout nested
 * inside a box. Clicking the region's padding selects it (the next palette
 * click changes this layout). Clicking a text field selects that field
 * instead (the next palette click builds a layout inside it).
 */
export const LayoutRegion = ({
  operator,
  parts,
  path,
  selectedPath,
  onSelect,
  onPartsChange,
  onFlattenRefused,
}: {
  operator: IdsOperator;
  parts: ComposerSlot[];
  path: number[];
  selectedPath: number[];
  onSelect: (path: number[]) => void;
  onPartsChange: (parts: ComposerSlot[]) => void;
  onFlattenRefused: () => void;
}) => {
  const selected = pathsEqual(path, selectedPath);
  const updatePart = (index: number, next: ComposerSlot) => {
    const updated = [...parts];
    updated[index] = next;
    onPartsChange(updated);
  };

  return (
    <Box
      role="group"
      aria-label={path.length === 0 ? 'Composition' : `${partNameOfRegion(operator)} layout`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(path);
      }}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: '2px solid',
        borderColor: selected ? ORANGE : 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <SlotArrangement
        operator={operator}
        parts={parts}
        path={path}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onPartChange={updatePart}
        onFlattenRefused={onFlattenRefused}
      />
    </Box>
  );
};

/** The × has to live where the parent can replace this region. */
const NestedRegion = ({
  slot,
  path,
  selectedPath,
  onSelect,
  onChange,
  onFlattenRefused,
}: {
  slot: Extract<ComposerSlot, { kind: 'nested' }>;
  path: number[];
  selectedPath: number[];
  onSelect: (path: number[]) => void;
  onChange: (slot: ComposerSlot) => void;
  onFlattenRefused: () => void;
}) => (
  <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
    <Tooltip title="Remove this layout">
      <IconButton
        size="small"
        aria-label="Remove this layout"
        onClick={(event) => {
          event.stopPropagation();
          const flat = flattenNestedSlot(slot);
          if (!flat.ok) {
            onFlattenRefused();
            return;
          }
          onChange(flat.slot);
          onSelect(path);
        }}
        sx={{ position: 'absolute', top: 0, right: 0, zIndex: 2, p: 0, width: 18, height: 18 }}
      >
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Tooltip>
    <LayoutRegion
      operator={slot.operator}
      parts={slot.parts}
      path={path}
      selectedPath={selectedPath}
      onSelect={onSelect}
      onPartsChange={(parts) => onChange({ ...slot, parts })}
      onFlattenRefused={onFlattenRefused}
    />
  </Box>
);

const partNameOfRegion = (operator: IdsOperator): string =>
  IDS_OPERATORS.find((entry) => entry.operator === operator)?.label ?? operator;

const SlotCell = ({
  slot,
  name,
  path,
  selectedPath,
  onSelect,
  onChange,
  onFlattenRefused,
}: {
  slot: ComposerSlot;
  name: string;
  path: number[];
  selectedPath: number[];
  onSelect: (path: number[]) => void;
  onChange: (slot: ComposerSlot) => void;
  onFlattenRefused: () => void;
}) => {
  if (slot.kind === 'nested') {
    return (
      <NestedRegion
        slot={slot}
        path={path}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onChange={onChange}
        onFlattenRefused={onFlattenRefused}
      />
    );
  }

  const selected = pathsEqual(path, selectedPath);
  return (
    <TextField
      placeholder="字"
      size="small"
      value={slot.input}
      onClick={(event) => event.stopPropagation()}
      onFocus={() => onSelect(path)}
      onChange={(event) => onChange({ kind: 'leaf', input: event.target.value })}
      slotProps={{ htmlInput: { 'aria-label': name } }}
      sx={{
        width: '100%',
        maxWidth: 96,
        '& input': { textAlign: 'center', fontSize: 18, px: 0.5 },
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: selected ? ORANGE : undefined,
          borderWidth: selected ? 2 : undefined,
        },
      }}
    />
  );
};

const cellSx = {
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  p: 0.5,
  boxSizing: 'border-box' as const,
};

const SlotArrangement = ({
  operator,
  parts,
  path,
  selectedPath,
  onSelect,
  onPartChange,
  onFlattenRefused,
}: {
  operator: IdsOperator;
  parts: ComposerSlot[];
  path: number[];
  selectedPath: number[];
  onSelect: (path: number[]) => void;
  onPartChange: (index: number, slot: ComposerSlot) => void;
  onFlattenRefused: () => void;
}) => {
  const renderAt = (index: number) => (
    <SlotCell
      slot={parts[index] ?? emptyLeafSlot()}
      name={partName(operator, index)}
      path={[...path, index]}
      selectedPath={selectedPath}
      onSelect={onSelect}
      onChange={(next) => onPartChange(index, next)}
      onFlattenRefused={onFlattenRefused}
    />
  );

  if (operator === '⿰' || operator === '⿲') {
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${parts.length}, 1fr)`,
          width: '100%',
          height: '100%',
        }}
      >
        {parts.map((_, index) => (
          <Box key={index} sx={{ ...cellSx, ...(index > 0 ? dashedSplit('left') : {}) }}>
            {renderAt(index)}
          </Box>
        ))}
      </Box>
    );
  }

  if (operator === '⿱' || operator === '⿳') {
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateRows: `repeat(${parts.length}, 1fr)`,
          width: '100%',
          height: '100%',
        }}
      >
        {parts.map((_, index) => (
          <Box key={index} sx={{ ...cellSx, ...(index > 0 ? dashedSplit('top') : {}) }}>
            {renderAt(index)}
          </Box>
        ))}
      </Box>
    );
  }

  if (operator === '⿻') {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
        }}
      >
        {parts.map((_, index) => (
          <Box key={index}>{renderAt(index)}</Box>
        ))}
      </Box>
    );
  }

  // Enclosures: the first part is the surrounding component, the second
  // sits in the opening. The inner box is dashed so it reads as "inside".
  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <Box sx={{ position: 'absolute', ...enclosureOuter(operator), ...cellSx }}>{renderAt(0)}</Box>
      <Box
        sx={{
          position: 'absolute',
          ...enclosureInner(operator),
          ...cellSx,
          border: '1px dashed',
          borderColor: 'text.disabled',
        }}
      >
        {renderAt(1)}
      </Box>
    </Box>
  );
};

const enclosureOuter = (operator: IdsOperator): Record<string, string | number> => {
  switch (operator) {
    case '⿵':
      return { top: 4, left: 4, right: 4, height: '38%' };
    case '⿶':
      return { bottom: 4, left: 4, right: 4, height: '38%' };
    case '⿷':
      return { top: 4, bottom: 4, left: 4, width: '38%' };
    case '⿸':
      return { top: 4, left: 4, width: '42%', height: '42%' };
    case '⿹':
      return { top: 4, right: 4, width: '42%', height: '42%' };
    case '⿺':
      return { bottom: 4, left: 4, width: '42%', height: '42%' };
    default:
      return { top: 4, left: 4, right: 4, height: '36%' };
  }
};

const enclosureInner = (operator: IdsOperator): Record<string, string | number> => {
  switch (operator) {
    case '⿵':
      return { bottom: 8, left: '28%', right: '28%', height: '42%' };
    case '⿶':
      return { top: 8, left: '28%', right: '28%', height: '42%' };
    case '⿷':
      return { top: '28%', bottom: '28%', right: 8, width: '42%' };
    case '⿸':
      return { bottom: 8, right: 8, width: '46%', height: '46%' };
    case '⿹':
      return { bottom: 8, left: 8, width: '46%', height: '46%' };
    case '⿺':
      return { top: 8, right: 8, width: '46%', height: '46%' };
    default:
      return { top: '32%', left: '22%', right: '22%', bottom: '18%' };
  }
};
