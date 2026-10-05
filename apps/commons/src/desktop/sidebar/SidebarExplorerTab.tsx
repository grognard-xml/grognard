import ClearIcon from '@mui/icons-material/Clear';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  getProjectSchemaDirPath,
  getRelativeFolderLabel,
  isPathUnder,
} from '@src/desktop/explorer/treeUtils';
import { useActions, useAppState } from '@src/overmind';
import type { FileTreeNode } from '@src/overmind/project/state';
import { modShortcut } from '@src/utils/platform';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ExplorerTarget,
  isExplorerItemProtected,
  useExplorerContextMenu,
} from './useExplorerContextMenu';
import { useExplorerDragDrop } from './useExplorerDragDrop';
import { useExplorerFileFilter } from './useExplorerFileFilter';
import { useExplorerTreeKeyboard } from './useExplorerTreeKeyboard';

interface TreeNodeProps {
  activeTabPath: string | null;
  depth: number;
  focusRow: (path: string) => void;
  focusedPath: string | null;
  focusedRowRef: React.RefObject<HTMLDivElement>;
  getDragProps: ReturnType<typeof useExplorerDragDrop>['getDragProps'];
  getDropProps: ReturnType<typeof useExplorerDragDrop>['getDropProps'];
  isDropTarget: ReturnType<typeof useExplorerDragDrop>['isDropTarget'];
  isExpanded: (path: string) => boolean;
  loadDirectoryChildren: (dirPath: string) => Promise<void>;
  node: FileTreeNode;
  onActivatePane: () => void;
  onContextMenu: (event: React.MouseEvent, item: ExplorerTarget) => void;
  onOpenFile: (filePath: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
}

const TreeNode = ({
  activeTabPath,
  depth,
  focusRow,
  focusedPath,
  focusedRowRef,
  getDragProps,
  getDropProps,
  isDropTarget,
  isExpanded,
  loadDirectoryChildren,
  node,
  onActivatePane,
  onContextMenu,
  onOpenFile,
  setExpanded,
}: TreeNodeProps) => {
  const item: ExplorerTarget = {
    isDirectory: node.isDirectory,
    name: node.name,
    path: node.path,
  };
  const dragProps = getDragProps(item);
  const dropProps = node.isDirectory ? getDropProps(item) : {};
  const interactionProps = { ...dragProps, ...dropProps } as React.HTMLAttributes<HTMLDivElement>;
  const expanded = node.isDirectory && isExpanded(node.path);
  const isActiveFile = !node.isDirectory && node.path === activeTabPath;
  const isFocused = focusedPath === node.path;
  const isHighlightedDrop = node.isDirectory && isDropTarget(node.path);

  const toggleExpand = async () => {
    if (!node.isDirectory) return;
    if (!node.childrenLoaded) {
      await loadDirectoryChildren(node.path);
      setExpanded(node.path, true);
      return;
    }
    setExpanded(node.path, !expanded);
  };

  const handleClick = async () => {
    onActivatePane();
    focusRow(node.path);
    if (node.isDirectory) {
      await toggleExpand();
      return;
    }
    onOpenFile(node.path);
  };

  return (
    <>
      <ListItemButton
        component="div"
        ref={isFocused ? focusedRowRef : undefined}
        dense
        data-explorer-row
        selected={isActiveFile || isFocused}
        onClick={() => void handleClick()}
        onContextMenu={(event) => onContextMenu(event, item)}
        onDoubleClick={() => {
          if (!node.isDirectory) onOpenFile(node.path);
        }}
        {...interactionProps}
        sx={{
          pl: 1 + depth * 1.5,
          py: 0.125,
          minHeight: 26,
          ...(isActiveFile && { bgcolor: 'action.selected' }),
          ...(isFocused && !isActiveFile && { outline: '1px solid', outlineColor: 'primary.main' }),
          ...(isHighlightedDrop && { bgcolor: 'action.hover' }),
        }}
      >
        <ListItemIcon sx={{ minWidth: 26 }}>
          {node.isDirectory ? (
            <FolderOpenIcon sx={{ fontSize: 16 }} />
          ) : (
            <InsertDriveFileOutlinedIcon sx={{ fontSize: 16 }} />
          )}
        </ListItemIcon>
        <ListItemText
          primary={node.name}
          sx={{ my: 0 }}
          primaryTypographyProps={{ noWrap: true, fontSize: '0.8125rem', lineHeight: 1.2 }}
        />
      </ListItemButton>
      {node.isDirectory && node.children && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <List disablePadding>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                activeTabPath={activeTabPath}
                depth={depth + 1}
                focusRow={focusRow}
                focusedPath={focusedPath}
                focusedRowRef={focusedRowRef}
                getDragProps={getDragProps}
                getDropProps={getDropProps}
                isDropTarget={isDropTarget}
                isExpanded={isExpanded}
                loadDirectoryChildren={loadDirectoryChildren}
                node={child}
                onActivatePane={onActivatePane}
                onContextMenu={onContextMenu}
                onOpenFile={onOpenFile}
                setExpanded={setExpanded}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
};

export const SidebarExplorerTab = () => {
  const { activeTabPath, config, isProjectReady, rootPath, tree } = useAppState().project;
  const {
    loadDirectoryChildren,
    openFile,
    openProject,
    reloadDirectoryInTree,
    setExplorerFocusedPath,
  } = useActions().project;
  const { t } = useTranslation();
  const treePaneRef = useRef<HTMLDivElement>(null);
  const focusedRowRef = useRef<HTMLDivElement>(null);
  const { filterQuery, isFiltering, matches, setFilterQuery } = useExplorerFileFilter(
    rootPath,
    isProjectReady,
  );
  const { getDragProps, getDropProps, isDropTarget } = useExplorerDragDrop(!isFiltering);
  const {
    anchorPos,
    closeMenu,
    deleteTargetItem,
    handleBackgroundContextMenu,
    handleContextMenu,
    handleDeleteClick,
    handleMoveClick,
    handleNewFolderClick,
    handleNewFolderConfirm,
    handleRenameClick,
    handleShowInFolderClick,
    handleRenameConfirm,
    isProtected,
    menuOpen,
    newFolderOpen,
    newFolderValue,
    openRenameForItem,
    renameOpen,
    renameValue,
    setNewFolderOpen,
    setNewFolderValue,
    setRenameOpen,
    setRenameValue,
    target,
  } = useExplorerContextMenu();

  const schemaDirPath = useMemo(
    () => (rootPath && config?.schema ? getProjectSchemaDirPath(rootPath, config.schema) : null),
    [config?.schema, rootPath],
  );

  const visibleFilterMatches = useMemo(
    () => matches.filter((match) => !schemaDirPath || !isPathUnder(match.path, schemaDirPath)),
    [matches, schemaDirPath],
  );

  const handleOpenFile = (filePath: string) => {
    void openFile(filePath);
  };

  const treeKeyboard = useExplorerTreeKeyboard(
    tree,
    isProjectReady && !isFiltering,
    handleOpenFile,
    async (dirPath) => {
      await loadDirectoryChildren(dirPath);
    },
  );

  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [treeKeyboard.focusedPath]);

  useEffect(() => {
    const item = treeKeyboard.getFocusedItem();
    if (!item || !rootPath) return;
    setExplorerFocusedPath({ path: item.path, isDirectory: item.isDirectory });
    // Depends on `treeKeyboard.focusedPath` rather than the whole `treeKeyboard`
    // the rule asks for: the hook rebuilds that object every render, so naming it
    // would run this on every render instead of when the focused row moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, setExplorerFocusedPath, treeKeyboard.focusedPath]);

  const refreshExplorer = useCallback(() => {
    if (!rootPath) return;
    void reloadDirectoryInTree(rootPath);
  }, [reloadDirectoryInTree, rootPath]);

  useEffect(() => {
    // Fired by the Electron menu bridge when the user presses F5.
    window.addEventListener('desktop:refresh', refreshExplorer);
    return () => window.removeEventListener('desktop:refresh', refreshExplorer);
  }, [refreshExplorer]);

  const handleTreeKeyDown = async (event: React.KeyboardEvent) => {
    if (event.key === 'F2') {
      const item = treeKeyboard.getFocusedItem();
      if (!item || isExplorerItemProtected(item, rootPath, schemaDirPath)) return;
      event.preventDefault();
      openRenameForItem(item);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const item = treeKeyboard.getFocusedItem();
      if (!item || isExplorerItemProtected(item, rootPath, schemaDirPath)) return;
      event.preventDefault();
      await deleteTargetItem(item);
      return;
    }
    await treeKeyboard.handleTreeKeyDown(event);
  };

  const handleTreePaneContextMenu = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('[data-explorer-row]')) return;
    handleBackgroundContextMenu(event);
  };

  const showRootOnlyMenu = Boolean(target && rootPath && target.path === rootPath);

  const activatePane = () => {
    treePaneRef.current?.focus();
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {rootPath ? (
        <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.5 }}>
          <TextField
            fullWidth
            size="small"
            placeholder={t('LWC.desktop.explorer.filter_placeholder')}
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            InputProps={{
              endAdornment: filterQuery ? (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={t('LWC.commons.cancel')}
                    edge="end"
                    size="small"
                    onClick={() => setFilterQuery('')}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            }}
          />
          <Tooltip title={t('LWC.desktop.explorer.refresh')}>
            <span>
              <IconButton onClick={refreshExplorer} size="small">
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      ) : null}

      <Box
        ref={treePaneRef}
        tabIndex={isProjectReady && !isFiltering && tree.length > 0 ? 0 : -1}
        onContextMenu={handleTreePaneContextMenu}
        onKeyDown={(event) => void handleTreeKeyDown(event)}
        sx={{
          flex: 1,
          overflow: 'auto',
          outline: 'none',
          minHeight: 0,
        }}
      >
        {!rootPath ? (
          <Button
            fullWidth
            onClick={() => void openProject()}
            startIcon={<FolderOpenIcon sx={{ fontSize: 16 }} />}
            sx={{
              p: 2,
              justifyContent: 'flex-start',
              textAlign: 'left',
              textTransform: 'none',
              color: 'text.secondary',
              fontWeight: 400,
            }}
          >
            {t('LWC.desktop.explorer.open_project_hint', { shortcut: modShortcut('O') })}
          </Button>
        ) : isFiltering ? (
          visibleFilterMatches.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {t('LWC.desktop.explorer.filter_no_results', { query: filterQuery.trim() })}
            </Typography>
          ) : (
            <List dense disablePadding>
              {visibleFilterMatches.map((match) => {
                const folderLabel = rootPath ? getRelativeFolderLabel(match.path, rootPath) : '';
                const isSelected = match.path === activeTabPath;

                return (
                  <ListItemButton
                    key={match.path}
                    dense
                    selected={isSelected}
                    onClick={() => handleOpenFile(match.path)}
                    onContextMenu={(event) =>
                      handleContextMenu(event, {
                        isDirectory: false,
                        name: match.name,
                        path: match.path,
                      })
                    }
                    onDoubleClick={() => handleOpenFile(match.path)}
                    sx={{
                      py: 0.125,
                      minHeight: 26,
                      ...(isSelected && { bgcolor: 'action.selected' }),
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 26 }}>
                      <InsertDriveFileOutlinedIcon sx={{ fontSize: 16 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={match.name}
                      secondary={folderLabel || undefined}
                      sx={{ my: 0 }}
                      primaryTypographyProps={{
                        noWrap: true,
                        fontSize: '0.8125rem',
                        lineHeight: 1.2,
                      }}
                      secondaryTypographyProps={{ noWrap: true, fontSize: '0.6875rem' }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          )
        ) : tree.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, minHeight: '100%' }}>
            {t('LWC.desktop.explorer.open_project_hint', { shortcut: modShortcut('O') })}
          </Typography>
        ) : (
          <List dense disablePadding sx={{ minHeight: '100%' }}>
            {tree.map((node) => (
              <TreeNode
                key={node.path}
                activeTabPath={activeTabPath}
                depth={0}
                focusRow={treeKeyboard.focusRow}
                focusedPath={treeKeyboard.focusedPath}
                focusedRowRef={focusedRowRef}
                getDragProps={getDragProps}
                getDropProps={getDropProps}
                isDropTarget={isDropTarget}
                isExpanded={treeKeyboard.isExpanded}
                loadDirectoryChildren={loadDirectoryChildren}
                node={node}
                onActivatePane={activatePane}
                onContextMenu={handleContextMenu}
                onOpenFile={handleOpenFile}
                setExpanded={treeKeyboard.setExpanded}
              />
            ))}
          </List>
        )}
      </Box>

      <Menu
        anchorReference="anchorPosition"
        anchorPosition={anchorPos ?? undefined}
        onClose={closeMenu}
        open={menuOpen}
      >
        {target?.isDirectory ? (
          <MenuItem onClick={() => void handleNewFolderClick()}>
            {t('LWC.desktop.explorer.new_folder')}
          </MenuItem>
        ) : null}
        {target ? (
          <MenuItem onClick={() => void handleShowInFolderClick()}>
            {t('LWC.desktop.explorer.show_in_folder')}
          </MenuItem>
        ) : null}
        {!showRootOnlyMenu ? (
          <>
            <MenuItem disabled={isProtected} onClick={() => void handleRenameClick()}>
              {t('LWC.desktop.explorer.rename')}
            </MenuItem>
            <MenuItem disabled={isProtected} onClick={() => void handleMoveClick()}>
              {t('LWC.desktop.explorer.move')}
            </MenuItem>
            <MenuItem disabled={isProtected} onClick={() => void handleDeleteClick()}>
              {t('LWC.desktop.explorer.delete')}
            </MenuItem>
          </>
        ) : null}
      </Menu>

      <Dialog fullWidth maxWidth="xs" onClose={() => setRenameOpen(false)} open={renameOpen}>
        <DialogTitle>{t('LWC.desktop.explorer.rename_title')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            placeholder={t('LWC.desktop.explorer.rename_placeholder')}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRenameConfirm();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>{t('LWC.commons.cancel')}</Button>
          <Button onClick={() => void handleRenameConfirm()} variant="contained">
            {t('LWC.desktop.explorer.rename')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog fullWidth maxWidth="xs" onClose={() => setNewFolderOpen(false)} open={newFolderOpen}>
        <DialogTitle>{t('LWC.desktop.explorer.new_folder_title')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            placeholder={t('LWC.desktop.explorer.new_folder_placeholder')}
            value={newFolderValue}
            onChange={(event) => setNewFolderValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleNewFolderConfirm();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderOpen(false)}>{t('LWC.commons.cancel')}</Button>
          <Button onClick={() => void handleNewFolderConfirm()} variant="contained">
            {t('LWC.desktop.explorer.new_folder')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
