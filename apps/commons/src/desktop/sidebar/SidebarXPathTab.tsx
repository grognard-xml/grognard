import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  Box,
  CircularProgress,
  Collapse,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { useAppState } from '@src/overmind';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchHistoryButton, type SearchHistoryItem } from '../find/SearchHistoryButton';
import {
  addXPathEntry,
  readXPathHistory,
  writeXPathHistory,
  type XPathHistoryEntry,
} from '../find/searchHistory';
import { searchXPath } from '../xpath/searchXPath';
import type { XPathFileResult } from '../xpath/types';
import { ScopeFields } from '../shared/ScopeFields';
import { SEARCH_SCOPE_LABEL_KEYS, type SearchScope } from '../shared/searchScope';
import { useXPathJump } from '../xpath/useXPathJump';
import {
  DESKTOP_LEFT_PANEL_EVENT,
  DESKTOP_XPATH_SEARCH_EVENT,
  type DesktopXPathSearchDetail,
} from '../desktopLeftPanelBridge';

interface FlatXPathResult {
  filePath: string;
  key: string;
  label: string;
  resultIndex: number;
  xpath: string;
}

const flattenResults = (
  results: XPathFileResult[],
  collapsedFilePaths: Set<string>,
): FlatXPathResult[] => {
  const flat: FlatXPathResult[] = [];
  for (const fileResult of results) {
    if (collapsedFilePaths.has(fileResult.filePath)) continue;

    for (const match of fileResult.matches) {
      flat.push({
        filePath: fileResult.filePath,
        key: `${fileResult.filePath}-${match.resultIndex}-${match.xpath}`,
        label: match.label,
        resultIndex: match.resultIndex,
        xpath: match.xpath,
      });
    }
  }
  return flat;
};

export const SidebarXPathTab = () => {
  const { t } = useTranslation();
  const { activeTabPath, openTabs, rootPath } = useAppState().project;

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('currentFile');
  const [customPath, setCustomPath] = useState('');
  const [results, setResults] = useState<XPathFileResult[]>([]);
  const [collapsedFilePaths, setCollapsedFilePaths] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<XPathHistoryEntry[]>(() => readXPathHistory());
  const historyRef = useRef(history);

  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const keyboardNavRef = useRef(false);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const refocusSelectedItem = useCallback(() => {
    keyboardNavRef.current = true;
    requestAnimationFrame(() => {
      itemRefs.current.get(selectedIndexRef.current)?.focus({ preventScroll: true });
    });
  }, []);

  const { jumpToMatch } = useXPathJump(refocusSelectedItem);

  const flatResults = useMemo(
    () => flattenResults(results, collapsedFilePaths),
    [results, collapsedFilePaths],
  );

  const toggleFileCollapsed = useCallback(
    (filePath: string) => {
      setCollapsedFilePaths((prev) => {
        const next = new Set(prev);
        if (next.has(filePath)) {
          next.delete(filePath);
          return next;
        }

        next.add(filePath);
        if (flatResults[selectedIndex]?.filePath === filePath) {
          const remaining = flattenResults(results, next);
          setSelectedIndex(remaining.length > 0 ? 0 : -1);
        }
        return next;
      });
    },
    [flatResults, results, selectedIndex],
  );

  const jumpToFlatResult = useCallback(
    (index: number) => {
      const item = flatResults[index];
      if (!item) return;

      jumpToMatch({
        filePath: item.filePath,
        query: query.trim(),
        resultIndex: item.resultIndex,
        xpath: item.xpath,
      });
    },
    [flatResults, jumpToMatch, query],
  );

  const navigateToIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= flatResults.length) return;
      keyboardNavRef.current = true;
      setSelectedIndex(index);
      jumpToFlatResult(index);
    },
    [flatResults.length, jumpToFlatResult],
  );

  useEffect(() => {
    itemRefs.current.clear();
    if (results.length > 0) {
      keyboardNavRef.current = true;
      setSelectedIndex(0);
    }
  }, [results]);

  useEffect(() => {
    itemRefs.current.clear();
    if (flatResults.length > 0) {
      setSelectedIndex((index) => {
        if (index < 0) return 0;
        if (index >= flatResults.length) return flatResults.length - 1;
        return index;
      });
    } else {
      setSelectedIndex(-1);
    }
  }, [flatResults]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const el = itemRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: 'nearest' });
    if (keyboardNavRef.current) {
      el?.focus({ preventScroll: true });
      keyboardNavRef.current = false;
    }
  }, [selectedIndex]);

  const handleResultsKeyDown = (event: React.KeyboardEvent) => {
    if (flatResults.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, flatResults.length - 1);
      navigateToIndex(next);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = selectedIndex < 0 ? 0 : Math.max(selectedIndex - 1, 0);
      navigateToIndex(next);
      return;
    }

    if (event.key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault();
      jumpToFlatResult(selectedIndex);
    }
  };

  const updateHistory = useCallback((next: XPathHistoryEntry[]) => {
    historyRef.current = next;
    setHistory(next);
    writeXPathHistory(next);
  }, []);

  const recordSearch = useCallback(
    (entry: XPathHistoryEntry) => updateHistory(addXPathEntry(historyRef.current, entry)),
    [updateHistory],
  );

  /** Puts a remembered search back in the panel. It never runs anything, and it drops the old
   * results, which belong to the previous query. */
  const applyHistoryEntry = useCallback(
    (index: number) => {
      const entry = history[index];
      if (!entry) return;
      setQuery(entry.query);
      setScope(entry.scope);
      setCustomPath(entry.customPath);
      setResults([]);
      setCollapsedFilePaths(new Set());
      setSelectedIndex(-1);
      setError(null);
    },
    [history],
  );

  const historyItems: SearchHistoryItem[] = history.map((entry) => ({
    primary: entry.query,
    chips: [t(SEARCH_SCOPE_LABEL_KEYS[entry.scope])],
  }));

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    setCollapsedFilePaths(new Set());
    setSelectedIndex(-1);

    try {
      const { results: nextResults, error: searchError } = await searchXPath({
        activeTabPath,
        customPath,
        openTabs,
        query,
        rootPath,
        scope,
      });

      setResults(nextResults);

      if (searchError) {
        setError(searchError);
      } else {
        recordSearch({ query, scope, customPath });
        if (nextResults.length === 0) setError('No results.');
      }
    } catch {
      setError('Search failed.');
    } finally {
      setLoading(false);
    }
  }, [activeTabPath, customPath, openTabs, query, recordSearch, rootPath, scope]);

  useEffect(() => {
    const handlePrefill = (event: Event) => {
      const detail = (event as CustomEvent<DesktopXPathSearchDetail>).detail;
      if (!detail?.query) return;
      setQuery(detail.query);
      setScope('currentFile');
      setResults([]);
      setError(null);
      window.dispatchEvent(new CustomEvent(DESKTOP_LEFT_PANEL_EVENT, { detail: { tab: 'xpath' } }));
      requestAnimationFrame(
        () =>
          void searchXPath({
            activeTabPath,
            customPath: '',
            openTabs,
            query: detail.query,
            rootPath,
            scope: 'currentFile',
          }).then(({ results: nextResults, error: searchError }) => {
            setResults(nextResults);
            setError(searchError ?? (nextResults.length === 0 ? 'No results.' : null));
            if (!searchError) {
              recordSearch({ query: detail.query, scope: 'currentFile', customPath: '' });
            }
          }),
      );
    };

    window.addEventListener(DESKTOP_XPATH_SEARCH_EVENT, handlePrefill);
    return () => window.removeEventListener(DESKTOP_XPATH_SEARCH_EVENT, handlePrefill);
  }, [activeTabPath, openTabs, recordSearch, rootPath]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        sx={{
          p: 1,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder={t('LWC.desktop.sidebar.xpath.xpath_placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleSearch();
              return;
            }
            if (event.key === 'ArrowDown' && flatResults.length > 0) {
              event.preventDefault();
              navigateToIndex(0);
              resultsContainerRef.current?.focus();
            }
          }}
          slotProps={{
            input: {
              sx: { fontSize: '0.8125rem' },
              endAdornment: (
                <InputAdornment position="end">
                  <SearchHistoryButton
                    items={historyItems}
                    onSelect={applyHistoryEntry}
                    onRemove={(index) =>
                      updateHistory(history.filter((_, position) => position !== index))
                    }
                    onClear={() => updateHistory([])}
                    label={t('LWC.desktop.sidebar.xpath.history', {
                      defaultValue: 'Search history',
                    })}
                  />
                </InputAdornment>
              ),
            },
          }}
        />
        <ScopeFields
          scope={scope}
          onScopeChange={setScope}
          customPath={customPath}
          onCustomPathChange={setCustomPath}
          onEnter={() => void handleSearch()}
          scopeLabelId="xpath-scope-label"
        />
      </Box>

      <Box
        ref={resultsContainerRef}
        tabIndex={flatResults.length > 0 ? 0 : -1}
        onKeyDown={handleResultsKeyDown}
        role="listbox"
        aria-activedescendant={selectedIndex >= 0 ? `xpath-result-${selectedIndex}` : undefined}
        sx={{
          flex: 1,
          overflow: 'auto',
          outline: 'none',
          '&:focus-visible': {
            boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
          },
        }}
      >
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {!loading && error && (
          <Typography
            variant="body2"
            color={results.length === 0 ? 'error' : 'text.secondary'}
            sx={{ p: 1.5 }}
          >
            {error}
          </Typography>
        )}

        {!loading &&
          (() => {
            let flatIndex = 0;

            return results.map((fileResult) => {
              const isCollapsed = collapsedFilePaths.has(fileResult.filePath);

              return (
                <Box key={fileResult.filePath}>
                  <ListItemButton
                    dense
                    onClick={() => toggleFileCollapsed(fileResult.filePath)}
                    sx={{
                      py: 0.25,
                      minHeight: 24,
                      bgcolor: 'action.hover',
                      borderBottom: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 22 }}>
                      {isCollapsed ? (
                        <ChevronRightIcon sx={{ fontSize: 14 }} />
                      ) : (
                        <ExpandMoreIcon sx={{ fontSize: 14 }} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={`${fileResult.filename} (${fileResult.matches.length})`}
                      sx={{ my: 0 }}
                      primaryTypographyProps={{
                        noWrap: true,
                        variant: 'caption',
                        fontWeight: 600,
                        color: 'text.secondary',
                      }}
                    />
                  </ListItemButton>
                  <Collapse in={!isCollapsed} timeout="auto" unmountOnExit>
                    <List dense disablePadding>
                      {fileResult.matches.map((match) => {
                        const currentIndex = flatIndex;
                        flatIndex += 1;

                        return (
                          <ListItemButton
                            key={`${fileResult.filePath}-${match.resultIndex}-${match.xpath}`}
                            id={`xpath-result-${currentIndex}`}
                            ref={(element) => {
                              if (element) {
                                itemRefs.current.set(currentIndex, element);
                              } else {
                                itemRefs.current.delete(currentIndex);
                              }
                            }}
                            dense
                            role="option"
                            aria-selected={currentIndex === selectedIndex}
                            selected={currentIndex === selectedIndex}
                            tabIndex={-1}
                            onClick={() => {
                              setSelectedIndex(currentIndex);
                              jumpToFlatResult(currentIndex);
                            }}
                            onFocus={() => setSelectedIndex(currentIndex)}
                            sx={{ py: 0.125, minHeight: 26 }}
                          >
                            <ListItemText
                              primary={match.xpath}
                              sx={{ my: 0 }}
                              primaryTypographyProps={{
                                noWrap: true,
                                fontFamily: 'monospace',
                                fontSize: '0.6875rem',
                                lineHeight: 1.3,
                              }}
                            />
                          </ListItemButton>
                        );
                      })}
                    </List>
                  </Collapse>
                </Box>
              );
            });
          })()}
      </Box>
    </Box>
  );
};
