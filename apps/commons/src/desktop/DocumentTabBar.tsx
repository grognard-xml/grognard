import { clearFindHighlights } from '@src/desktop/find/findEditorHighlights';
import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Tab, Tabs, Typography } from '@mui/material';
import { leafwriterAtom } from '@src/jotai';
import { useActions, useAppState } from '@src/overmind';
import { isDesktop } from '@src/types/desktop';
import { useAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import { documentTabIndicatorSx, documentTabSx } from './documentTabStyles';
import { attachTabWheelScroll } from './tabWheelScroll';
import { mergeEditorBodyWithStoredHeader, stripTeiHeaderForVisualEditor } from './teiHeaderXml';

const canonicalizeActiveEditorContent = (
  content: string | undefined,
  fallbackXml: string | undefined,
): string | undefined => {
  if (!content || !isDesktop()) return content;
  if (window.writer?.overmindState?.ui?.editorViewMode === 'source') return content;

  const baseXml =
    window.__desktopStoredDocumentXml ??
    fallbackXml ??
    window.writer?.overmindState?.document?.xml ??
    content;
  return mergeEditorBodyWithStoredHeader(stripTeiHeaderForVisualEditor(content), baseXml);
};

export const DocumentTabBar = () => {
  const { activeTabPath, openTabs } = useAppState().project;
  const { contentHasChanged } = useAppState().editor;
  const { closeTab, promptCloseDirtyTab, switchTab } = useActions().project;
  const [leafWriter] = useAtom(leafwriterAtom);
  const tabsRef = useRef<HTMLDivElement>(null);
  const hasTabs = openTabs.length > 0;

  useEffect(() => {
    const root = tabsRef.current;
    return root ? attachTabWheelScroll(root) : undefined;
  }, [hasTabs]);

  if (!hasTabs) return null;

  const handleChange = async (_event: React.SyntheticEvent, filePath: string) => {
    if (filePath === activeTabPath) return;
    clearFindHighlights();
    const activeTab = openTabs.find((tab) => tab.filePath === activeTabPath);
    const rawContent = leafWriter ? await leafWriter.getContent() : undefined;
    const content = canonicalizeActiveEditorContent(rawContent, activeTab?.content);
    await switchTab({ content, filePath });
  };

  const handleClose = async (event: React.MouseEvent, filePath: string) => {
    event.stopPropagation();
    clearFindHighlights();

    const tab = openTabs.find((item) => item.filePath === filePath);
    if (!tab) return;

    const isActive = filePath === activeTabPath;
    const isDirty = isActive ? contentHasChanged : tab.dirty;

    if (isDirty && isDesktop()) {
      const contentOverride =
        isActive && leafWriter
          ? canonicalizeActiveEditorContent(await leafWriter.getContent(), tab.content)
          : tab.content;
      const result = await promptCloseDirtyTab({
        tab: {
          content: tab.content,
          filePath: tab.filePath,
          filename: tab.filename,
          isTemp: tab.isTemp,
        },
        contentOverride,
      });
      if (result === 'abort' || result === 'handled') return;
    }

    const content =
      filePath === activeTabPath && leafWriter
        ? canonicalizeActiveEditorContent(await leafWriter.getContent(), tab.content)
        : undefined;
    await closeTab({ content, filePath });
  };

  return (
    <Tabs
      ref={tabsRef}
      value={activeTabPath ?? false}
      onChange={(event, value) => void handleChange(event, value as string)}
      variant="scrollable"
      scrollButtons="auto"
      sx={{ minHeight: 28 }}
      slotProps={{ indicator: { sx: documentTabIndicatorSx } }}
      TabScrollButtonProps={{ style: { WebkitAppRegion: 'no-drag' } as React.CSSProperties }}
    >
      {openTabs.map((tab) => {
        const isActive = tab.filePath === activeTabPath;
        const isDirty = isActive ? contentHasChanged : tab.dirty;
        const label = `${tab.filename}${isDirty ? ' *' : ''}${tab.externalChangePending ? ' ↻' : ''}`;
        return (
          <Tab
            key={tab.filePath}
            value={tab.filePath}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Typography
                  component="span"
                  title={label}
                  variant="body2"
                  sx={{
                    display: 'block',
                    flex: '0 1 auto',
                    minWidth: 0,
                    maxWidth: '30ch',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </Typography>
                <IconButton
                  component="span"
                  size="small"
                  onClick={(event) => void handleClose(event, tab.filePath)}
                  sx={{ p: 0.25, color: 'inherit' }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            }
            sx={documentTabSx}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          />
        );
      })}
    </Tabs>
  );
};
