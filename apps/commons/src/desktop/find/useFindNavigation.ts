import { useActions, useAppState } from '@src/overmind';
import { useCallback, useEffect, useRef } from 'react';
import { describeTeiXPathWalkFailure } from '../xpath/teiXPathWalker';
import { performFindJump } from './performFindJump';
import { resolveTextHitInXml } from './resolveTextHitInXml';
import type { PendingFindJump } from './types';

/**
 * A jump that never lands used to fail silently. Say which stage gave up, so a
 * failure can be traced to the file/editor mismatch, the offset-to-element
 * mapping or the editor DOM walk instead of guessed at.
 */
const reportFailedJump = (
  jump: PendingFindJump,
  currentPath: string | null | undefined,
  content?: string,
) => {
  const writer = window.writer;
  const mode = writer?.overmindState?.ui?.editorViewMode;
  const editorContent = jump.contentForJump ?? content;
  const stage = !writer
    ? 'no-writer'
    : currentPath !== jump.filePath
      ? 'file-not-active'
      : !editorContent
        ? 'no-content'
        : mode !== 'source' && !writer.editor
          ? 'editor-not-ready'
          : 'locate-hit';
  const details: Record<string, unknown> = {
    stage,
    mode,
    file: jump.filePath,
    activeFile: currentPath,
    start: jump.start,
    end: jump.end,
    contentLength: editorContent?.length,
  };
  if (stage === 'locate-hit' && editorContent && mode !== 'source') {
    const resolved = resolveTextHitInXml(editorContent, jump.start, jump.end);
    details.resolvedXPath = resolved?.teiXPath ?? null;
    const body = writer?.editor?.getBody();
    if (resolved && body)
      details.walkFailure = describeTeiXPathWalkFailure(body, resolved.teiXPath);
  }
  console.warn('[find-jump] could not reach the hit', details);
};

export const useFindNavigation = (onAfterJump?: () => void) => {
  const { activeTabPath, openTabs } = useAppState().project;
  const { resource } = useAppState().editor;
  const { openFile } = useActions().project;

  const pendingJumpRef = useRef<PendingFindJump | null>(null);
  const onAfterJumpRef = useRef(onAfterJump);
  const resourceFilePathRef = useRef(resource?.filePath);
  const activeTabPathRef = useRef(activeTabPath);
  const openTabsRef = useRef(openTabs);
  const retryTimersRef = useRef<number[]>([]);

  onAfterJumpRef.current = onAfterJump;
  resourceFilePathRef.current = resource?.filePath;
  activeTabPathRef.current = activeTabPath;
  openTabsRef.current = openTabs;

  const getTabContent = useCallback((filePath: string) => {
    return openTabsRef.current.find((tab) => tab.filePath === filePath)?.content;
  }, []);

  const completeJump = useCallback(() => {
    pendingJumpRef.current = null;
    onAfterJumpRef.current?.();
  }, []);

  const getContentForJump = useCallback(
    (filePath: string) => {
      if (window.writer?.overmindState?.ui?.editorViewMode === 'source') {
        const currentPath = resourceFilePathRef.current ?? activeTabPathRef.current;
        if (currentPath === filePath) {
          return window.writer.overmindState.ui.sourceCurrentContent;
        }
      }

      return getTabContent(filePath);
    },
    [getTabContent],
  );

  const tryPerformPendingJump = useCallback(() => {
    const jump = pendingJumpRef.current;
    if (!jump || !window.writer) return false;

    const isSourceMode = window.writer.overmindState?.ui?.editorViewMode === 'source';
    if (!isSourceMode && !window.writer.editor) return false;

    const currentPath = resourceFilePathRef.current ?? activeTabPathRef.current;
    if (currentPath !== jump.filePath) return false;

    const content = getContentForJump(jump.filePath);
    if (!content) return false;

    if (
      performFindJump({
        content,
        contentForJump: jump.contentForJump,
        end: jump.end,
        highlightMode: jump.highlightMode,
        ignoreCase: jump.ignoreCase,
        query: jump.query,
        start: jump.start,
        useRegex: jump.useRegex,
      })
    ) {
      completeJump();
      return true;
    }

    return false;
  }, [completeJump, getContentForJump]);

  const schedulePendingJumpRetries = useCallback(() => {
    retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    retryTimersRef.current = [];

    for (const delay of [0, 100, 350, 800, 1500]) {
      const timer = window.setTimeout(() => {
        if (pendingJumpRef.current) tryPerformPendingJump();
      }, delay);
      retryTimersRef.current.push(timer);
    }
    const reportTimer = window.setTimeout(() => {
      const jump = pendingJumpRef.current;
      if (!jump) return;
      const currentPath = resourceFilePathRef.current ?? activeTabPathRef.current;
      reportFailedJump(jump, currentPath, getContentForJump(jump.filePath));
    }, 2000);
    retryTimersRef.current.push(reportTimer);
  }, [getContentForJump, tryPerformPendingJump]);

  useEffect(() => {
    const writer = window.writer;
    if (!writer) return;

    const onDocumentLoaded = (success: boolean) => {
      if (!success || !pendingJumpRef.current) return;
      schedulePendingJumpRetries();
    };

    writer.event('documentLoaded').subscribe(onDocumentLoaded);
    return () => {
      writer.event('documentLoaded').unsubscribe(onDocumentLoaded);
      retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      retryTimersRef.current = [];
    };
  }, [schedulePendingJumpRetries]);

  const jumpToHit = useCallback(
    (jump: PendingFindJump) => {
      const currentFilePath = resource?.filePath ?? activeTabPath;
      const isActive = currentFilePath === jump.filePath;
      const isSourceMode = window.writer?.overmindState?.ui?.editorViewMode === 'source';
      const content = getContentForJump(jump.filePath);

      if (isActive && window.writer && content && (isSourceMode || window.writer.editor)) {
        if (
          performFindJump({
            content,
            contentForJump: jump.contentForJump,
            end: jump.end,
            highlightMode: jump.highlightMode,
            ignoreCase: jump.ignoreCase,
            query: jump.query,
            start: jump.start,
            useRegex: jump.useRegex,
          })
        ) {
          pendingJumpRef.current = null;
          onAfterJumpRef.current?.();
        } else {
          pendingJumpRef.current = jump;
          schedulePendingJumpRetries();
        }
        return;
      }

      pendingJumpRef.current = jump;
      void (async () => {
        await openFile(jump.filePath);
        schedulePendingJumpRetries();
      })();
    },
    [activeTabPath, getContentForJump, openFile, resource?.filePath, schedulePendingJumpRetries],
  );

  return { jumpToHit };
};
