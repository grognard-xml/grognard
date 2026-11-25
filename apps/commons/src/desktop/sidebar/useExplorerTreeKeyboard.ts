import type { FileTreeNode } from '@src/overmind/project/state';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExplorerTarget } from './useExplorerContextMenu';

export interface FlatTreeRow {
  depth: number;
  node: FileTreeNode;
}

export const flattenVisibleTree = (
  nodes: FileTreeNode[],
  expandedPaths: Set<string>,
  depth = 0,
): FlatTreeRow[] => {
  const rows: FlatTreeRow[] = [];
  for (const node of nodes) {
    rows.push({ depth, node });
    if (
      node.isDirectory &&
      expandedPaths.has(node.path) &&
      node.children &&
      node.children.length > 0
    ) {
      rows.push(...flattenVisibleTree(node.children, expandedPaths, depth + 1));
    }
  }
  return rows;
};

export const useExplorerTreeKeyboard = (
  tree: FileTreeNode[],
  enabled: boolean,
  onOpenFile: (filePath: string) => void,
  loadDirectoryChildren: (dirPath: string) => Promise<void>,
) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || tree.length === 0) return;
    setExpandedPaths((current) => {
      const next = new Set(current);
      for (const node of tree) {
        if (node.isDirectory) next.add(node.path);
      }
      return next;
    });
  }, [enabled, tree]);

  const flatRows = useMemo(
    () => (enabled ? flattenVisibleTree(tree, expandedPaths) : []),
    [enabled, expandedPaths, tree],
  );

  const setExpanded = useCallback((path: string, expanded: boolean) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (expanded) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const isExpanded = useCallback((path: string) => expandedPaths.has(path), [expandedPaths]);

  const focusRow = useCallback((path: string) => {
    setFocusedPath(path);
  }, []);

  const getParentPath = useCallback(
    (path: string): string | null => {
      const index = flatRows.findIndex((row) => row.node.path === path);
      if (index <= 0) return null;
      const depth = flatRows[index].depth;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (flatRows[i].depth < depth) return flatRows[i].node.path;
      }
      return null;
    },
    [flatRows],
  );

  const expandFolder = useCallback(
    async (node: FileTreeNode) => {
      if (!node.isDirectory) return;
      if (!node.childrenLoaded) {
        await loadDirectoryChildren(node.path);
      }
      setExpanded(node.path, true);
    },
    [loadDirectoryChildren, setExpanded],
  );

  /** Open the focused row: a file opens, a folder expands. */
  const openFocused = useCallback(async () => {
    const row = flatRows.find((item) => item.node.path === focusedPath);
    if (!row) return;
    if (row.node.isDirectory) await expandFolder(row.node);
    else onOpenFile(row.node.path);
  }, [expandFolder, flatRows, focusedPath, onOpenFile]);

  const focusParent = useCallback(() => {
    if (!focusedPath) return;
    const parentPath = getParentPath(focusedPath);
    if (parentPath) setFocusedPath(parentPath);
  }, [focusedPath, getParentPath]);

  const handleTreeKeyDown = useCallback(
    async (event: React.KeyboardEvent) => {
      if (!enabled || flatRows.length === 0) return;

      const currentIndex = focusedPath
        ? flatRows.findIndex((row) => row.node.path === focusedPath)
        : -1;
      const activeIndex = currentIndex >= 0 ? currentIndex : 0;
      const activeRow = flatRows[activeIndex];

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = flatRows[Math.min(activeIndex + 1, flatRows.length - 1)];
        if (next) setFocusedPath(next.node.path);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = flatRows[Math.max(activeIndex - 1, 0)];
        if (next) setFocusedPath(next.node.path);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (!activeRow.node.isDirectory) return;
        if (!isExpanded(activeRow.node.path)) {
          await expandFolder(activeRow.node);
          return;
        }
        const child = flatRows[activeIndex + 1];
        if (child && child.depth > activeRow.depth) {
          setFocusedPath(child.node.path);
        }
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (activeRow.node.isDirectory && isExpanded(activeRow.node.path)) {
          setExpanded(activeRow.node.path, false);
          return;
        }
        const parentPath = getParentPath(activeRow.node.path);
        if (parentPath) setFocusedPath(parentPath);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (activeRow.node.isDirectory) {
          if (!isExpanded(activeRow.node.path)) {
            await expandFolder(activeRow.node);
          } else {
            const child = flatRows[activeIndex + 1];
            if (child && child.depth > activeRow.depth) {
              setFocusedPath(child.node.path);
            }
          }
          return;
        }
        onOpenFile(activeRow.node.path);
      }
    },
    [
      enabled,
      expandFolder,
      flatRows,
      focusedPath,
      getParentPath,
      isExpanded,
      onOpenFile,
      setExpanded,
    ],
  );

  const getFocusedItem = useCallback((): ExplorerTarget | null => {
    if (!focusedPath) return null;
    const row = flatRows.find((item) => item.node.path === focusedPath);
    if (!row) return null;
    return {
      isDirectory: row.node.isDirectory,
      name: row.node.name,
      path: row.node.path,
    };
  }, [flatRows, focusedPath]);

  return {
    expandedPaths,
    flatRows,
    focusParent,
    focusRow,
    focusedPath,
    getFocusedItem,
    handleTreeKeyDown,
    isExpanded,
    openFocused,
    setExpanded,
  };
};
