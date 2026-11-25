import { getParentPath, getProjectSchemaDirPath } from '@src/desktop/explorer/treeUtils';
import { useActions, useAppState } from '@src/overmind';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ExplorerTarget, isExplorerItemProtected } from './useExplorerContextMenu';

const DRAG_MIME = 'application/x-grognard-explorer-path';

type ExplorerDragProps = React.HTMLAttributes<HTMLDivElement> & {
  draggable: boolean;
};

let dragGhostEl: HTMLDivElement | null = null;

const getDragGhostElement = (): HTMLDivElement => {
  if (!dragGhostEl) {
    dragGhostEl = document.createElement('div');
    dragGhostEl.style.cssText =
      'position:fixed;top:-1000px;left:-1000px;padding:4px 10px;border-radius:4px;font:13px/1.3 system-ui,sans-serif;white-space:nowrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    document.body.appendChild(dragGhostEl);
  }
  return dragGhostEl;
};

const applyDragGhostTheme = (element: HTMLDivElement) => {
  element.style.background = 'var(--mui-palette-background-paper, #fff)';
  element.style.color = 'var(--mui-palette-text-primary, #111)';
  element.style.border = '1px solid var(--mui-palette-divider, #ccc)';
};

export interface ExplorerDragPayload {
  isDirectory: boolean;
  name: string;
  path: string;
}

export const isPathInside = (parent: string, child: string): boolean => {
  const prefix = parent.endsWith('/') ? parent : `${parent}/`;
  return child === parent || child.startsWith(prefix);
};

export const canDropOnFolder = (
  source: ExplorerDragPayload,
  destDir: string,
  rootPath: string | null,
  schemaDirPath?: string | null,
): boolean => {
  if (!destDir) return false;
  if (source.path === destDir) return false;
  if (getParentPath(source.path) === destDir) return false;
  if (isExplorerItemProtected(source, rootPath, schemaDirPath)) return false;
  if (
    isExplorerItemProtected({ isDirectory: true, name: '', path: destDir }, rootPath, schemaDirPath)
  ) {
    return false;
  }
  if (source.isDirectory && isPathInside(source.path, destDir)) return false;
  return true;
};

export const useExplorerDragDrop = (enabled: boolean) => {
  const { config, rootPath } = useAppState().project;
  const { moveExplorerItem } = useActions().project;
  const { notifyViaSnackbar } = useActions().ui;
  const { t } = useTranslation();
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const dragSourceRef = useRef<ExplorerDragPayload | null>(null);
  const schemaDirPath =
    rootPath && config?.schema ? getProjectSchemaDirPath(rootPath, config.schema) : null;

  const showMoveError = useCallback(
    (error?: string) => {
      if (error === 'exists') {
        notifyViaSnackbar({
          message: t('LWC.desktop.explorer.error_exists'),
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

  const getDragProps = useCallback(
    (item: ExplorerTarget): ExplorerDragProps => {
      if (!enabled || isExplorerItemProtected(item, rootPath, schemaDirPath)) {
        return { draggable: false as const };
      }

      return {
        draggable: true as const,
        onDragEnd: () => {
          dragSourceRef.current = null;
          setDropTargetPath(null);
        },
        onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
          event.stopPropagation();
          const payload: ExplorerDragPayload = {
            isDirectory: item.isDirectory,
            name: item.name,
            path: item.path,
          };
          dragSourceRef.current = payload;
          event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
          event.dataTransfer.effectAllowed = 'move';
          const ghost = getDragGhostElement();
          applyDragGhostTheme(ghost);
          ghost.textContent = item.name;
          event.dataTransfer.setDragImage(ghost, 12, 12);
        },
      };
    },
    [enabled, rootPath, schemaDirPath],
  );

  const getDropProps = useCallback(
    (folder: ExplorerTarget): React.HTMLAttributes<HTMLDivElement> => {
      if (!enabled || !folder.isDirectory) {
        return {};
      }

      return {
        onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
          event.stopPropagation();
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDropTargetPath((current) => (current === folder.path ? null : current));
        },
        onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          event.stopPropagation();

          const source = dragSourceRef.current;
          if (!source) return;

          if (canDropOnFolder(source, folder.path, rootPath, schemaDirPath)) {
            event.dataTransfer.dropEffect = 'move';
            setDropTargetPath(folder.path);
            return;
          }

          event.dataTransfer.dropEffect = 'none';
        },
        onDrop: (event: React.DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          event.stopPropagation();
          setDropTargetPath(null);

          const raw = event.dataTransfer.getData(DRAG_MIME);
          let source = dragSourceRef.current;
          if (!source && raw) {
            try {
              source = JSON.parse(raw) as ExplorerDragPayload;
            } catch {
              source = null;
            }
          }

          dragSourceRef.current = null;

          if (!source) return;

          if (!canDropOnFolder(source, folder.path, rootPath, schemaDirPath)) {
            notifyViaSnackbar({
              message: t('LWC.desktop.explorer.drop_invalid'),
              options: { variant: 'error' },
            });
            return;
          }

          void moveExplorerItem({ destDir: folder.path, sourcePath: source.path }).then(
            (result) => {
              if (!result.success) showMoveError(result.error);
            },
          );
        },
      };
    },
    [enabled, moveExplorerItem, notifyViaSnackbar, rootPath, schemaDirPath, showMoveError, t],
  );

  return { dropTargetPath, getDragProps, getDropProps };
};
