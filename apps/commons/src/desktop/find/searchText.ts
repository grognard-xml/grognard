import type { OpenTab } from '@src/overmind/project/state';
import { collectXmlFiles } from '../xpath/collectXmlFiles';
import { isTranslationFile } from '../translationFileNaming';
import type { SearchScope } from '../shared/searchScope';
import { matchesDocScope, type DocScope } from './docScope';
import { getCompanionTranslationFilePaths } from './translationCompanionResults';
import { filterHitsForWysiwygEditor } from './wysiwygVisibleHits';
import { tryCompileFindRegex } from './regexPatternUtils';
import { searchInContent } from './textSearchUtils';
import { syncActiveVisualTabContent } from './liveVisualContent';
import type { FindFileResult } from './types';

const getFilename = (filePath: string) => filePath.split(/[/\\]/).pop() ?? filePath;

const isSourceEditorMode = () => window.writer?.overmindState?.ui?.editorViewMode === 'source';

/** Live buffer for the active tab in Source mode; otherwise the tab snapshot. */
const getContentForSearch = (
  tab: OpenTab,
  activeTabPath: string | null,
  liveVisualContent: string | null,
) => {
  if (tab.filePath === activeTabPath) {
    if (isSourceEditorMode()) {
      return window.writer?.overmindState?.ui?.sourceCurrentContent || tab.content;
    }
    if (liveVisualContent) return liveVisualContent;
  }
  return tab.content;
};

const buildFileResult = (
  filePath: string,
  content: string,
  query: string,
  useRegex: boolean,
  ignoreCase: boolean,
) => {
  let matches = searchInContent(content, query, useRegex, ignoreCase);
  if (!isSourceEditorMode()) {
    matches = filterHitsForWysiwygEditor(content, matches);
  }
  if (matches.length === 0) return null;

  return {
    filePath,
    filename: getFilename(filePath),
    matches,
  } satisfies FindFileResult;
};

export interface SearchTextParams {
  activeTabPath: string | null;
  customPath?: string;
  docScope?: DocScope;
  openTabs: OpenTab[];
  query: string;
  rootPath: string | null;
  scope: SearchScope;
  ignoreCase?: boolean;
  useRegex: boolean;
}

export interface SearchTextResult {
  error?: string;
  results: FindFileResult[];
  totalMatches: number;
}

export const searchText = async ({
  activeTabPath,
  customPath,
  docScope = 'both',
  openTabs,
  query,
  rootPath,
  scope,
  ignoreCase = false,
  useRegex,
}: SearchTextParams): Promise<SearchTextResult> => {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], totalMatches: 0 };

  if (!window.electronAPI) {
    return { results: [], totalMatches: 0, error: 'Desktop file access is unavailable.' };
  }

  if (useRegex) {
    if (!tryCompileFindRegex(trimmed, ignoreCase)) {
      return {
        results: [],
        totalMatches: 0,
        error: 'Invalid regular expression.',
      };
    }
  }

  const results: FindFileResult[] = [];
  const liveVisualContent = await syncActiveVisualTabContent(activeTabPath);

  const addResult = (result: FindFileResult | null) => {
    if (result) results.push(result);
  };

  /** Translation companion files are never open as tabs, so currentFile/openTabs scope has
   * to fetch their content directly rather than relying on the tab list. */
  const addCompanionResults = async (sourcePath: string) => {
    if (docScope === 'source' || isTranslationFile(sourcePath)) return;

    const companionPaths = await getCompanionTranslationFilePaths(sourcePath);
    for (const companionPath of companionPaths) {
      try {
        const content = await window.electronAPI!.readFile(companionPath);
        addResult(buildFileResult(companionPath, content, trimmed, useRegex, ignoreCase));
      } catch {
        // companion doesn't exist yet for this language — skip
      }
    }
  };

  try {
    if (scope === 'currentFile') {
      if (!activeTabPath) {
        return { results: [], totalMatches: 0, error: 'No file is open.' };
      }

      const tab = openTabs.find((item) => item.filePath === activeTabPath);
      if (!tab) {
        return { results: [], totalMatches: 0, error: 'No file is open.' };
      }

      if (matchesDocScope(activeTabPath, docScope)) {
        addResult(
          buildFileResult(
            activeTabPath,
            getContentForSearch(tab, activeTabPath, liveVisualContent),
            trimmed,
            useRegex,
            ignoreCase,
          ),
        );
      }
      await addCompanionResults(activeTabPath);
    } else if (scope === 'openTabs') {
      if (openTabs.length === 0) {
        return { results: [], totalMatches: 0, error: 'No files are open.' };
      }

      for (const tab of openTabs) {
        if (matchesDocScope(tab.filePath, docScope)) {
          addResult(
            buildFileResult(
              tab.filePath,
              getContentForSearch(tab, activeTabPath, liveVisualContent),
              trimmed,
              useRegex,
              ignoreCase,
            ),
          );
        }

        await addCompanionResults(tab.filePath);
      }
    } else if (scope === 'project') {
      if (!rootPath) {
        return { results: [], totalMatches: 0, error: 'Open a project folder first.' };
      }

      const filePaths = (await collectXmlFiles(rootPath)).filter((filePath) =>
        matchesDocScope(filePath, docScope),
      );
      for (const filePath of filePaths) {
        const content = await window.electronAPI.readFile(filePath);
        addResult(buildFileResult(filePath, content, trimmed, useRegex, ignoreCase));
      }
    } else if (scope === 'custom') {
      const folderPath = customPath?.trim();
      if (!folderPath) {
        return { results: [], totalMatches: 0, error: 'Enter a folder path.' };
      }

      try {
        await window.electronAPI.readDirectory(folderPath, { allFiles: true });
      } catch {
        return { results: [], totalMatches: 0, error: 'Folder path is not accessible.' };
      }

      const filePaths = (await collectXmlFiles(folderPath)).filter((filePath) =>
        matchesDocScope(filePath, docScope),
      );
      for (const filePath of filePaths) {
        const content = await window.electronAPI.readFile(filePath);
        addResult(buildFileResult(filePath, content, trimmed, useRegex, ignoreCase));
      }
    }
  } catch (error) {
    return {
      results: [],
      totalMatches: 0,
      error: error instanceof Error ? error.message : 'Search failed.',
    };
  }

  const totalMatches = results.reduce((sum, file) => sum + file.matches.length, 0);

  return { results, totalMatches };
};
