import { Box, Divider, Paper, Popper, Typography } from '@mui/material';
import { useAtomValue } from 'jotai';
import { AnimatePresence } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useActions } from '../../../../overmind';
import { showOnlyValidAtom } from '../../store';
import { Item, NoResultItem, type ItemProps } from '../item';
import { Filters, Skeleton } from './components';
import { rankMenuItems } from './rankMenuItems';

interface CollectionsProps {
  isLoading?: boolean;
  list: ItemProps[];
  /** False while a keepMounted submenu is closed. */
  open?: boolean;
  searchable?: boolean;
}

const MIN_SHOW_SEARCH = 10;
const MAX_SCROLL_HEIGHT = 420;
/** How long the pointer must rest on another row before an open submenu gives way to it. */
const SWITCH_DELAY_MS = 300;
/** Pause before an item's documentation card appears, so it doesn't flash while moving. */
const DOC_DELAY_MS = 350;

export const Collection = ({
  isLoading = false,
  list,
  open = true,
  searchable = false,
}: CollectionsProps) => {
  const onlyValid = useAtomValue(showOnlyValidAtom);

  const { ui } = useActions();

  const [activeItem, setActiveItem] = useState<string>();
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const [docCard, setDocCard] = useState<{ anchor: HTMLElement; text: string } | null>(null);
  const switchTimer = useRef<number>();

  const cancelPendingSwitch = () => {
    if (switchTimer.current === undefined) return;
    window.clearTimeout(switchTimer.current);
    switchTimer.current = undefined;
  };

  useEffect(() => cancelPendingSwitch, []);

  const visibleList = useMemo(
    () => rankMenuItems(list, query).filter((item) => (onlyValid ? !item.invalid : item)),
    [list, query, onlyValid],
  );

  const isSelectable = (item?: ItemProps) =>
    Boolean(item && item.type !== 'divider' && item.onClick && !item.disabled);

  // Typing a query pre-selects the best match so Enter picks it; clearing it drops the selection.
  useEffect(() => {
    const first = visibleList.findIndex((item) => isSelectable(item));
    setHighlightIndex(query.trim() && first >= 0 ? first : -1);
    // Only a new query (or filter) resets the selection, not every list identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onlyValid, list]);

  useEffect(() => {
    listRef.current?.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex]);

  // A closed (keepMounted) submenu keeps its state; don't leave a selection or card behind.
  useEffect(() => {
    if (!open) setHighlightIndex(-1);
  }, [open]);

  // Documentation for the selected row (mouse or keyboard) opens in a card beside the menu. The
  // old hover tooltip sat under the row and covered the next one; this never overlaps the list.
  useEffect(() => {
    setDocCard(null);
    const text = open && highlightIndex >= 0 ? visibleList[highlightIndex]?.documentation : null;
    if (!text) return;
    const timer = window.setTimeout(() => {
      const anchor = listRef.current?.querySelector<HTMLElement>('[data-highlighted]');
      if (anchor) setDocCard({ anchor, text });
    }, DOC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [highlightIndex, open, visibleList]);

  const moveHighlight = (direction: 1 | -1) => {
    const count = visibleList.length;
    if (count === 0) return;
    let index = highlightIndex;
    for (let step = 0; step < count; step++) {
      index = (index + direction + count) % count;
      if (isSelectable(visibleList[index])) {
        setHighlightIndex(index);
        return;
      }
    }
  };

  const handleFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Escape must still reach the menu so it can close. Everything else stays in the input:
    // the surrounding MenuList would otherwise treat letters as type-ahead and pull focus away.
    if (event.key === 'Escape') return;
    event.stopPropagation();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = visibleList[highlightIndex];
      if (!item || !isSelectable(item)) return;
      ui.closeContextMenu();
      item.onClick?.();
    }
  };

  const handleQuery = (query: string) => setQuery(query);

  const handleMouseEnter = (id = '', index = -1) => {
    if (isSelectable(visibleList[index])) setHighlightIndex(index);

    // Coming back onto the row (or into its submenu) keeps things as they are.
    cancelPendingSwitch();

    // Moving diagonally from an open submenu's row toward the submenu crosses other rows on
    // the way. Switching at once would close the submenu under the pointer, so give way to
    // another row only once the pointer has rested on it.
    const current = visibleList.find((item) => (item.id ?? item.name) === activeItem);
    const leavingOpenSubmenu =
      activeItem !== undefined && activeItem !== id && current?.type === 'collection';
    if (!leavingOpenSubmenu) {
      setActiveItem(id);
      return;
    }
    switchTimer.current = window.setTimeout(() => {
      switchTimer.current = undefined;
      setActiveItem(id);
    }, SWITCH_DELAY_MS);
  };

  return (
    //reset pointer event here so that the menu items could receive mouse events
    <Box style={{ pointerEvents: 'auto' }}>
      {isLoading ? (
        <Skeleton />
      ) : (
        <Box>
          {searchable && list.length > MIN_SHOW_SEARCH && (
            <Filters onKeyDown={handleFilterKeyDown} onQuery={handleQuery} />
          )}
          <Box
            ref={listRef}
            overflow="auto"
            pt={0.5}
            sx={{ maxHeight: MAX_SCROLL_HEIGHT }}
            onMouseLeave={() => {
              // Hover selection ends with the pointer; a typed query keeps its pre-selection.
              if (!query.trim()) setHighlightIndex(-1);
            }}
          >
            <AnimatePresence>
              {visibleList.length === 0 ? (
                <NoResultItem />
              ) : (
                visibleList.map((item, index) =>
                  item.type === 'divider' ? (
                    <Divider key={index.toString()} sx={{ my: 0.5 }} variant="middle" />
                  ) : (
                    <Item
                      key={item.name}
                      {...item}
                      active={activeItem === (item.id ?? item.name)}
                      highlighted={index === highlightIndex}
                      id={item.id ?? item.name}
                      onMouseEnter={(id) => handleMouseEnter(id, index)}
                    />
                  ),
                )
              )}
            </AnimatePresence>
          </Box>
          <Popper
            anchorEl={docCard?.anchor}
            modifiers={[{ name: 'offset', options: { offset: [0, 10] } }]}
            open={Boolean(docCard)}
            placement="right-start"
            sx={{ zIndex: (theme) => theme.zIndex.tooltip, pointerEvents: 'none' }}
          >
            <Paper elevation={4} sx={{ maxWidth: 320, px: 1.25, py: 0.75 }}>
              <Typography sx={{ fontSize: '0.75rem', lineHeight: 1.4 }} variant="caption">
                {docCard?.text}
              </Typography>
            </Paper>
          </Popper>
        </Box>
      )}
    </Box>
  );
};
