import { MenuItem, Stack, useTheme } from '@mui/material';
import { motion, Variants } from 'motion/react';
import { forwardRef, MouseEvent, useMemo } from 'react';
import { type IconLeafWriter } from '../../../../icons';
import { useActions } from '../../../../overmind';
import { isEntityType } from '../../../../types';
import { Nest } from '../Nest';
import { IconLeft, IconRight, Label } from './components';
import { useItem } from './useItem';

export { NoResultItem } from './NoResultItem';

export type ItemType = 'action' | 'collection' | 'entity' | 'tag' | 'divider';

interface BaseProps {
  disabled?: boolean;
  icon?: IconLeafWriter;
  id?: string;
  name: string;
  type: ItemType;
}

interface TagItemProps extends BaseProps {
  documentation?: string;
  fullName?: string;
  invalid?: boolean;
  onClick?: () => void;
}

export interface CollectionItemProps extends BaseProps {
  active?: boolean;
  /** Keyboard-selected row (arrow keys in the filter); styled like hover. */
  highlighted?: boolean;
  children?: ItemProps[];
  getChildren?: () => Promise<ItemProps[]>;
  onMouseEnter?: (id?: string) => void;
  searchable?: boolean;
}

export interface ItemProps extends TagItemProps, CollectionItemProps {}

export const Item = forwardRef<any, ItemProps>(
  (
    {
      active = false,
      children,
      disabled = false,
      documentation,
      fullName,
      getChildren,
      highlighted = false,
      id,
      invalid,
      icon,
      name,
      onClick,
      onMouseEnter,
      searchable = true,
      type,
    },
    ref,
  ) => {
    const { ui } = useActions();
    const theme = useTheme();

    const { anchorEl, isEmpty, isLoading, nestedList, setAnchorEl, showNestedMenu } = useItem({
      active,
      children,
      getChildren,
      type,
    });

    const handleMouseEnter = (event: MouseEvent<HTMLElement, globalThis.MouseEvent>) => {
      if (type === 'collection') setAnchorEl(event.currentTarget);
      onMouseEnter && onMouseEnter(id);
    };

    const handleClick = () => {
      if (!onClick) return;

      ui.closeContextMenu();
      onClick && onClick();
    };

    const color =
      id && isEntityType(id, theme.entity)
        ? theme.entity[id].color.main
        : theme.palette.primary.main;

    const rigthIconProps = useMemo<{ icon: IconLeafWriter; size?: number } | null>(() => {
      if (type === 'collection') {
        return isEmpty ? { icon: 'block' } : { icon: 'arrowForwardIosIcon', size: 12 };
      }
      if (['tag', 'entity'].includes(type) && invalid) return { icon: 'invalid' };
      return null;
    }, [isEmpty, invalid, type]);

    const itemVariants: Variants = {
      hidden: { y: -10, opacity: 0 },
      show: { y: 0, opacity: 1 },
    };

    return (
      <MenuItem
        component={motion.div}
        variants={itemVariants}
        initial={false}
        animate="show"
        exit="hidden"
        layout
        dense
        disabled={disabled}
        disableRipple
        data-highlighted={highlighted || undefined}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        sx={[
          {
            mx: 0.5,
            px: 0.75,
            py: 0.25,
            minHeight: 26,
            borderRadius: 1,
            backgroundColor: 'inherit',
            '&.Mui-focusVisible': { backgroundColor: 'inherit' },
            '&:hover': {
              color,
              backgroundColor: theme.alpha(color, theme.vars.palette.action.hoverOpacity),
            },
          },
          highlighted && {
            color,
            backgroundColor: theme.alpha(color, theme.vars.palette.action.hoverOpacity),
          },
          showNestedMenu && {
            backgroundColor: `rgba(${theme.vars.palette.primary.mainChannel}, ${theme.vars.palette.action.selectedOpacity})`,
            '&.Mui-focusVisible': {
              backgroundColor: `rgba(${theme.vars.palette.primary.mainChannel}, ${theme.vars.palette.action.selectedOpacity})`,
            },
          },
        ]}
        ref={ref}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          width="100%"
          columnGap={0.75}
        >
          {icon && <IconLeft icon={icon} entityType={id} />}
          <Label {...{ documentation, fullName, invalid, name }} />
          {rigthIconProps && <IconRight isLoading={isLoading} {...rigthIconProps} />}
        </Stack>
        {showNestedMenu && (
          <Nest
            anchorEl={anchorEl}
            isLoading={isLoading}
            items={nestedList}
            onMouseEnter={() => onMouseEnter?.(id)}
            searchable={searchable}
          />
        )}
      </MenuItem>
    );
  },
);
