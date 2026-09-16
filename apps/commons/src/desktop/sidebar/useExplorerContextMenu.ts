import { deleteExplorerTarget } from '@src/desktop/explorer/explorerDeleteTarget';
import {
  getParentPath,
  getPathBasename,
  getProjectSchemaDirPath,
  isPathUnder,
} from '@src/desktop/explorer/treeUtils';
import { useActions, useAppState } from '@src/overmind';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGACY_PROJECT_FILE_NAME, PROJECT_FILE_NAME } from '@src/desktop/projectFile';

export interface ExplorerTarget {
  isDirectory: boolean;
  name: string;
  path: string;
}

export const isExplorerItemProtected = (
  target: ExplorerTarget,
  rootPath: string | null,
  schemaDirPath?: string | null,
): boolean => {
  if (!rootPath) return true;
  if (target.path === rootPath) return true;
  if (target.name === PROJECT_FILE_NAME || target.name === LEGACY_PROJECT_FILE_NAME) return true;
  if (schemaDirPath && isPathUnder(target.path, schemaDirPath)) return true;
  return false;
};

export const useExplorerContextMenu = () => {
  const { activeTabPath, openTabs, rootPath, config } = useAppState().project;
  const { contentHasChanged } = useAppState().editor;
  const { skipExplorerDeleteConfirm } = useAppState().ui;
  const { createExplorerFolder, deleteExplorerItem, moveExplorerItem, renameExplorerItem } =
    useActions().project;
  const { notifyViaSnackbar } = useActions().ui;
  const { t } = useTranslation();

  const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null);
  const [target, setTarget] = useState<ExplorerTarget | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderValue, setNewFolderValue] = useState('');

  const schemaDirPath =
    rootPath && config?.schema ? getProjectSchemaDirPath(rootPath, config.schema) : null;

  const isProtected = target ? isExplorerItemProtected(target, rootPath, schemaDirPath) : true;

  const closeMenu = () => setAnchorPos(null);

  const showError = useCallback(
    (error?: string) => {
      if (error === 'exists') {
        notifyViaSnackbar({
          message: t('LWC.desktop.explorer.error_exists'),
          options: { variant: 'error' },
        });
        return;
      }
      if (error === 'invalid_name') {
        notifyViaSnackbar({
          message: t('LWC.desktop.explorer.error_invalid_name'),
          options: { variant: 'error' },
        });
        return;
      }
      if (error === 'into_self') {
        notifyViaSnackbar({
          message: t('LWC.desktop.explorer.error_into_self'),
          options: { variant: 'error' },
        });
        return;
      }
      if (error && error !== 'Unavailable') {
        notifyViaSnackbar({
          message: t('LWC.desktop.explorer.error_failed', { detail: error }),
          options: { variant: 'error' },
        });
      }
    },
    [notifyViaSnackbar, t],
  );

  const deleteTargetItem = useCallback(
    async (item: ExplorerTarget) => {
      if (isExplorerItemProtected(item, rootPath, schemaDirPath)) return false;

      const result = await deleteExplorerTarget({
        activeTabPath,
        contentHasChanged,
        deleteExplorerItem,
        openTabs,
        skipDeleteConfirm: skipExplorerDeleteConfirm,
        t,
        target: item,
      });

      if (result.cancelled) return false;
      if (result.error) {
        showError(result.error);
        return false;
      }
      return true;
    },
    [
      activeTabPath,
      contentHasChanged,
      deleteExplorerItem,
      openTabs,
      rootPath,
      schemaDirPath,
      showError,
      skipExplorerDeleteConfirm,
      t,
    ],
  );

  const handleBackgroundContextMenu = (event: React.MouseEvent) => {
    if (!rootPath) return;
    event.preventDefault();
    event.stopPropagation();
    setTarget({
      isDirectory: true,
      name: getPathBasename(rootPath),
      path: rootPath,
    });
    setAnchorPos({ top: event.clientY, left: event.clientX });
  };

  const handleContextMenu = (event: React.MouseEvent, item: ExplorerTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setTarget(item);
    setAnchorPos({ top: event.clientY, left: event.clientX });
  };

  const handleRenameClick = () => {
    if (!target) return;
    closeMenu();
    setRenameValue(target.name);
    setRenameOpen(true);
  };

  const openRenameForItem = (item: ExplorerTarget) => {
    if (isExplorerItemProtected(item, rootPath, schemaDirPath)) return;
    setTarget(item);
    setRenameValue(item.name);
    setRenameOpen(true);
  };

  const handleNewFolderClick = () => {
    if (!target?.isDirectory) return;
    closeMenu();
    setNewFolderValue('');
    setNewFolderOpen(true);
  };

  const handleNewFolderConfirm = async () => {
    if (!target?.isDirectory) return;
    const result = await createExplorerFolder({
      folderName: newFolderValue,
      parentPath: target.path,
    });
    if (result.success) {
      setNewFolderOpen(false);
      setTarget(null);
      return;
    }
    showError(result.error);
  };

  const handleRenameConfirm = async () => {
    if (!target) return;
    const result = await renameExplorerItem({ newName: renameValue, oldPath: target.path });
    if (result.success) {
      setRenameOpen(false);
      setTarget(null);
      return;
    }
    showError(result.error);
  };

  const handleMoveClick = async () => {
    if (!target || !window.electronAPI?.pickMoveDestination) return;
    closeMenu();
    const defaultDir = target.isDirectory ? target.path : getParentPath(target.path);
    const destDir = await window.electronAPI.pickMoveDestination(defaultDir);
    if (!destDir) return;
    const result = await moveExplorerItem({ destDir, sourcePath: target.path });
    if (!result.success) showError(result.error);
    setTarget(null);
  };

  const handleDeleteClick = async () => {
    if (!target) return;
    closeMenu();
    const deleted = await deleteTargetItem(target);
    if (deleted) setTarget(null);
  };

  return {
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
    handleRenameConfirm,
    isProtected,
    menuOpen: Boolean(anchorPos),
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
  };
};
