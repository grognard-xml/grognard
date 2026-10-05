import { Menu } from '@mui/material';
import { MIN_WIDTH } from '..';
import { useWindowSize } from '../../../hooks';
import { Collection } from './collection';
import { ItemProps } from './item';

export interface NestProps {
  anchorEl: HTMLElement | null;
  isLoading?: boolean;
  items?: ItemProps[];
  /** Pointer entered the submenu itself (cancels a pending switch to another row). */
  onMouseEnter?: () => void;
  searchable?: boolean;
}

export const Nest = ({
  anchorEl,
  isLoading = false,
  items = [],
  onMouseEnter,
  searchable,
}: NestProps) => {
  const windowSize = useWindowSize();

  const anchorBoundingClientRect = anchorEl?.getBoundingClientRect();
  const isOpen = Boolean(anchorEl);

  const hasSpaceToTheRight = () => {
    if (!anchorBoundingClientRect || !windowSize || !windowSize.width) return true;
    //does mindWidth submenu fits next to the origin?
    return anchorBoundingClientRect.right + MIN_WIDTH < windowSize.width;
  };

  return (
    <Menu
      anchorEl={anchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: hasSpaceToTheRight() ? 'right' : 'left' }}
      MenuListProps={{ sx: { minWidth: MIN_WIDTH, py: 0, borderRadius: 1 } }}
      open={isOpen}
      PaperProps={{ elevation: 4, onMouseEnter }}
      style={{ pointerEvents: 'none' }} // "pointerEvents: none" to prevent invisible Popover wrapper div to capture mouse events
      transitionDuration={0}
      transformOrigin={{ vertical: 'top', horizontal: hasSpaceToTheRight() ? 'left' : 'right' }}
      variant="menu"
      keepMounted
    >
      <Collection isLoading={isLoading} list={items} open={isOpen} searchable={searchable} />
    </Menu>
  );
};
