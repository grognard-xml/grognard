import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  boxesEqual,
  defaultBoxesFor,
  type IdsOperator,
  type KageBox,
} from '../../utilities/kageCompose';

const CANVAS = 200;
const MIN_SIZE = 12;
const LIMIT_LOW = -20;
const LIMIT_HIGH = 220;
const HANDLE = 6;
const SNAP_RADIUS = 4;
const MARGIN = 14;

type EdgeMask = number;
const EDGE = { left: 1, top: 2, right: 4, bottom: 8, move: 16 } as const;

const clampBox = (box: KageBox): KageBox => {
  let { left, top, right, bottom } = box;
  left = Math.max(LIMIT_LOW, Math.min(LIMIT_HIGH, Math.round(left)));
  top = Math.max(LIMIT_LOW, Math.min(LIMIT_HIGH, Math.round(top)));
  right = Math.max(LIMIT_LOW, Math.min(LIMIT_HIGH, Math.round(right)));
  bottom = Math.max(LIMIT_LOW, Math.min(LIMIT_HIGH, Math.round(bottom)));
  if (right - left < MIN_SIZE) right = left + MIN_SIZE;
  if (bottom - top < MIN_SIZE) bottom = top + MIN_SIZE;
  return { left, top, right, bottom };
};

const boxWidth = (box: KageBox) => box.right - box.left;
const boxHeight = (box: KageBox) => box.bottom - box.top;

export interface LayoutAdjustDialogProps {
  open: boolean;
  operator: IdsOperator;
  /** Short labels for the component list (Left, Right, …). */
  partLabels: string[];
  /** Boxes currently applied (or defaults). */
  initialBoxes: KageBox[];
  /** Live SVG for the current draft boxes. */
  renderPreview: (boxes: KageBox[]) => string;
  onCancel: () => void;
  /** `null` means “use operator defaults again”. */
  onApply: (boxes: KageBox[] | null) => void;
}

/**
 * Drag / resize top-level component boxes (KAGE 0–200), matching marinaMoji’s
 * Adjust layout dialog at a practical depth: move, edge handles, snap, nudge
 * fields, centre, reset. Nested slots are not adjusted separately — only the
 * root operator’s boxes.
 */
export const LayoutAdjustDialog = ({
  open,
  operator,
  partLabels,
  initialBoxes,
  renderPreview,
  onCancel,
  onApply,
}: LayoutAdjustDialogProps) => {
  const defaults = useMemo(() => defaultBoxesFor(operator), [operator]);
  const [boxes, setBoxes] = useState<KageBox[]>(() => initialBoxes.map((b) => ({ ...b })));
  const [selected, setSelected] = useState(0);
  const [snapping, setSnapping] = useState(true);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    index: number;
    mask: EdgeMask;
    origin: KageBox;
    startRoot: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setBoxes(initialBoxes.map((b) => ({ ...b })));
    setSelected(0);
  }, [open, initialBoxes]);

  const svg = useMemo(() => renderPreview(boxes), [boxes, renderPreview]);

  const squareMetrics = useCallback(() => {
    const el = svgHostRef.current;
    if (!el) return { left: 0, top: 0, side: 1 };
    const w = el.clientWidth;
    const h = el.clientHeight;
    const side = Math.max(1, Math.min(w, h) - 2 * MARGIN);
    return { left: (w - side) / 2, top: (h - side) / 2, side };
  }, []);

  const rootToPixels = useCallback(
    (box: KageBox) => {
      const { left, top, side } = squareMetrics();
      const k = side / CANVAS;
      return {
        x: left + box.left * k,
        y: top + box.top * k,
        w: boxWidth(box) * k,
        h: boxHeight(box) * k,
      };
    },
    [squareMetrics],
  );

  const pixelsToRoot = useCallback(
    (px: number, py: number) => {
      const { left, top, side } = squareMetrics();
      const k = CANVAS / side;
      return { x: (px - left) * k, y: (py - top) * k };
    },
    [squareMetrics],
  );

  const updateSelected = (next: KageBox) => {
    setBoxes((prev) => prev.map((b, i) => (i === selected ? clampBox(next) : b)));
  };

  const snapBox = (rect: KageBox, mask: EdgeMask, forIndex: number): KageBox => {
    if (!snapping) return rect;
    const guidesX = [
      0,
      100,
      200,
      ...boxes.flatMap((b, i) => (i === forIndex ? [] : [b.left, b.right])),
    ];
    const guidesY = [
      0,
      100,
      200,
      ...boxes.flatMap((b, i) => (i === forIndex ? [] : [b.top, b.bottom])),
    ];
    const near = (value: number, guides: number[]) => {
      let best = value;
      let bestDist = SNAP_RADIUS + 1;
      for (const g of guides) {
        const d = Math.abs(value - g);
        if (d < bestDist) {
          bestDist = d;
          best = g;
        }
      }
      return bestDist <= SNAP_RADIUS ? best : value;
    };
    let { left, top, right, bottom } = rect;
    if (mask & EDGE.left || mask & EDGE.move) left = near(left, guidesX);
    if (mask & EDGE.right || mask & EDGE.move) right = near(right, guidesX);
    if (mask & EDGE.top || mask & EDGE.move) top = near(top, guidesY);
    if (mask & EDGE.bottom || mask & EDGE.move) bottom = near(bottom, guidesY);
    if (mask & EDGE.move) {
      const w = boxWidth(rect);
      const h = boxHeight(rect);
      right = left + w;
      bottom = top + h;
    }
    return { left, top, right, bottom };
  };

  const handleAt = (px: number, py: number): EdgeMask => {
    if (selected < 0 || selected >= boxes.length) return 0;
    const r = rootToPixels(boxes[selected]!);
    const slack = HANDLE + 2;
    const nearLeft = Math.abs(px - r.x) <= slack;
    const nearRight = Math.abs(px - (r.x + r.w)) <= slack;
    const nearTop = Math.abs(py - r.y) <= slack;
    const nearBottom = Math.abs(py - (r.y + r.h)) <= slack;
    const inX = px >= r.x - slack && px <= r.x + r.w + slack;
    const inY = py >= r.y - slack && py <= r.y + r.h + slack;
    let mask = 0;
    if (nearLeft && inY) mask |= EDGE.left;
    if (nearRight && inY) mask |= EDGE.right;
    if (nearTop && inX) mask |= EDGE.top;
    if (nearBottom && inX) mask |= EDGE.bottom;
    return mask;
  };

  const boxAt = (px: number, py: number): number => {
    let best = -1;
    let bestArea = Infinity;
    boxes.forEach((box, i) => {
      const r = rootToPixels(box);
      if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) return;
      const area = r.w * r.h;
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    });
    return best;
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    const host = svgHostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let mask = handleAt(px, py);
    let index = selected;
    if (!mask) {
      index = boxAt(px, py);
      if (index < 0) return;
      setSelected(index);
      mask = EDGE.move;
    }
    const origin = { ...boxes[index]! };
    const startRoot = pixelsToRoot(px, py);
    dragRef.current = { index, mask, origin, startRoot };
    host.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    const host = svgHostRef.current;
    if (!drag || !host) return;
    const rect = host.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const cur = pixelsToRoot(px, py);
    const dx = cur.x - drag.startRoot.x;
    const dy = cur.y - drag.startRoot.y;
    let next = { ...drag.origin };
    const { mask, origin, index } = drag;
    if (mask & EDGE.move) {
      const w = boxWidth(origin);
      const h = boxHeight(origin);
      next.left = origin.left + dx;
      next.top = origin.top + dy;
      next.right = next.left + w;
      next.bottom = next.top + h;
    } else {
      if (mask & EDGE.left) next.left = origin.left + dx;
      if (mask & EDGE.right) next.right = origin.right + dx;
      if (mask & EDGE.top) next.top = origin.top + dy;
      if (mask & EDGE.bottom) next.bottom = origin.bottom + dy;
    }
    next = snapBox(clampBox(next), mask, index);
    setBoxes((prev) => prev.map((b, i) => (i === index ? next : b)));
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    svgHostRef.current?.releasePointerCapture(event.pointerId);
  };

  const selectedBox = boxes[selected] ?? defaults[0]!;
  const isAdjusted = (i: number) => !boxesEqual([boxes[i]!], [defaults[i]!]);

  const applyNumeric = (field: 'left' | 'top' | 'width' | 'height', value: number) => {
    const next = { ...selectedBox };
    if (field === 'left') {
      const w = boxWidth(next);
      next.left = value;
      next.right = value + w;
    } else if (field === 'top') {
      const h = boxHeight(next);
      next.top = value;
      next.bottom = value + h;
    } else if (field === 'width') {
      next.right = next.left + Math.max(MIN_SIZE, value);
    } else {
      next.bottom = next.top + Math.max(MIN_SIZE, value);
    }
    updateSelected(next);
  };

  const handleApply = () => {
    onApply(boxesEqual(boxes, defaults) ? null : boxes.map((b) => ({ ...b })));
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>Adjust layout</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 260px' },
            gap: 2,
            pt: 1,
            minHeight: 360,
          }}
        >
          <Box
            ref={svgHostRef}
            tabIndex={0}
            aria-label="Layout drawing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 10 : 1;
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                updateSelected({
                  ...selectedBox,
                  left: selectedBox.left - step,
                  right: selectedBox.right - step,
                });
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                updateSelected({
                  ...selectedBox,
                  left: selectedBox.left + step,
                  right: selectedBox.right + step,
                });
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                updateSelected({
                  ...selectedBox,
                  top: selectedBox.top - step,
                  bottom: selectedBox.bottom - step,
                });
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                updateSelected({
                  ...selectedBox,
                  top: selectedBox.top + step,
                  bottom: selectedBox.bottom + step,
                });
              } else if (event.key === 'Tab') {
                event.preventDefault();
                setSelected((s) => (s + 1) % boxes.length);
              } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                setBoxes((prev) => prev.map((b, i) => (i === selected ? { ...defaults[i]! } : b)));
              }
            }}
            sx={{
              position: 'relative',
              bgcolor: 'grey.50',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              minHeight: 320,
              outline: 'none',
              '&:focus-visible': { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` },
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: MARGIN,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '& svg': { width: '100%', height: '100%', display: 'block' },
                pointerEvents: 'none',
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            {boxes.map((box, i) => {
              const r = rootToPixels(box);
              const active = i === selected;
              return (
                <Box
                  key={i}
                  sx={{
                    position: 'absolute',
                    left: r.x,
                    top: r.y,
                    width: r.w,
                    height: r.h,
                    border: '1.5px solid',
                    borderColor: active ? 'primary.main' : 'text.disabled',
                    borderStyle: active ? 'solid' : 'dashed',
                    bgcolor: active ? 'primary.main' : 'transparent',
                    opacity: active ? 0.15 : 1,
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              );
            })}
            {selected >= 0 && boxes[selected] && (
              <>
                {(() => {
                  const r = rootToPixels(boxes[selected]!);
                  const points = [
                    [r.x, r.y],
                    [r.x + r.w / 2, r.y],
                    [r.x + r.w, r.y],
                    [r.x + r.w, r.y + r.h / 2],
                    [r.x + r.w, r.y + r.h],
                    [r.x + r.w / 2, r.y + r.h],
                    [r.x, r.y + r.h],
                    [r.x, r.y + r.h / 2],
                  ];
                  return points.map(([x, y], hi) => (
                    <Box
                      key={hi}
                      sx={{
                        position: 'absolute',
                        left: x! - HANDLE,
                        top: y! - HANDLE,
                        width: HANDLE * 2,
                        height: HANDLE * 2,
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'primary.main',
                        pointerEvents: 'none',
                      }}
                    />
                  ));
                })()}
              </>
            )}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <Typography variant="subtitle2">Components</Typography>
            <List
              dense
              disablePadding
              sx={{
                maxHeight: 120,
                overflow: 'auto',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              {boxes.map((box, i) => (
                <ListItemButton key={i} selected={i === selected} onClick={() => setSelected(i)}>
                  <ListItemText
                    primary={`${i + 1}  ${partLabels[i] ?? `Part ${i + 1}`}${isAdjusted(i) ? '  *' : ''}`}
                    secondary={`${box.left},${box.top} → ${box.right},${box.bottom}`}
                    primaryTypographyProps={{ fontFamily: 'serif' }}
                  />
                </ListItemButton>
              ))}
            </List>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <TextField
                size="small"
                label="Left"
                type="number"
                value={selectedBox.left}
                onChange={(e) => applyNumeric('left', Number(e.target.value))}
                inputProps={{ 'aria-label': 'Left' }}
              />
              <TextField
                size="small"
                label="Top"
                type="number"
                value={selectedBox.top}
                onChange={(e) => applyNumeric('top', Number(e.target.value))}
                inputProps={{ 'aria-label': 'Top' }}
              />
              <TextField
                size="small"
                label="Width"
                type="number"
                value={boxWidth(selectedBox)}
                onChange={(e) => applyNumeric('width', Number(e.target.value))}
                inputProps={{ 'aria-label': 'Width' }}
              />
              <TextField
                size="small"
                label="Height"
                type="number"
                value={boxHeight(selectedBox)}
                onChange={(e) => applyNumeric('height', Number(e.target.value))}
                inputProps={{ 'aria-label': 'Height' }}
              />
            </Box>

            <FormControlLabel
              control={
                <Checkbox
                  checked={snapping}
                  onChange={(e) => setSnapping(e.target.checked)}
                  size="small"
                />
              }
              label="Snap to guides"
            />
            <Button
              size="small"
              onClick={() => {
                const w = boxWidth(selectedBox);
                updateSelected({
                  ...selectedBox,
                  left: Math.round(100 - w / 2),
                  right: Math.round(100 - w / 2) + w,
                });
              }}
            >
              Centre across
            </Button>
            <Button
              size="small"
              onClick={() => {
                const h = boxHeight(selectedBox);
                updateSelected({
                  ...selectedBox,
                  top: Math.round(100 - h / 2),
                  bottom: Math.round(100 - h / 2) + h,
                });
              }}
            >
              Centre down
            </Button>
            <Button
              size="small"
              onClick={() =>
                setBoxes((prev) => prev.map((b, i) => (i === selected ? { ...defaults[i]! } : b)))
              }
            >
              Reset component
            </Button>
            <Button size="small" onClick={() => setBoxes(defaults.map((b) => ({ ...b })))}>
              Reset all
            </Button>
            <Typography variant="caption" color="text.secondary">
              Drag a box to move it; drag handles to resize. Arrow keys nudge by 1 (Shift by 10).
              Tab picks the next component; Delete resets it. Adjusted layouts skip the Unicode
              Insert shortcut — use Save and insert.
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={handleApply}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LayoutAdjustDialog;
