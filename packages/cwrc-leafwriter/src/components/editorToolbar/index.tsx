import { Box, Divider, Paper, Stack, useTheme } from '@mui/material';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPluginToolbarItems, type PluginToolbarMenuItem } from '../../plugins/pluginExtensions';
import type { IconLeafWriter } from '../../icons';
import { useActions, useAppState } from '../../overmind';
import type { ChoiceDisplayMode } from '../../overmind/editor/state';
import { EntityType } from '../../types';
import { isAiUiFeatureEnabled } from '../../autoTagging/aiUiFeatures';
import {
  aiApiSettingsFromDesktop,
  isAiSuggestReady,
} from '../../autoTagging/llmClientFromSettings';
import { readPersistedDisambiguationSettings } from '../../autoTagging/disambiguationSettings';
import {
  insertStructuralElementAtCursor,
  splitParagraphAtCursor,
} from '../../utilities/structuralInsert';
import { promptForText } from '../../utilities/promptForText';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { MenuButton } from './MenuButton';
import { Toggle } from './Toggle';

type ItemType = 'button' | 'divider' | 'iconButton' | 'menuButton' | 'toggle';
type ItemGroup = 'action' | 'ui' | 'panel' | 'general';

const isDesktopApp = () =>
  typeof window !== 'undefined' && !!(window as Window & { electronAPI?: unknown }).electronAPI;

const CHOICE_DISPLAY_MODE_ICON: Record<ChoiceDisplayMode, IconLeafWriter> = {
  original: 'history',
  corrected: 'autoFixHigh',
  both: 'layers',
};

const CHOICE_DISPLAY_MODE_LABEL: Record<ChoiceDisplayMode, string> = {
  original: 'Original',
  corrected: 'Corrected',
  both: 'Both',
};

export interface Item {
  disabled?: boolean;
  hide?: boolean;
  type: ItemType;
  group: ItemGroup;
}

export interface MenuItem extends Item {
  color?: string;
  group: ItemGroup;
  icon: IconLeafWriter;
  onClick?: () => void;
  selected?: boolean;
  title?: string;
  tooltip?: string;
  /** For `type: 'menuButton'`: opens a dropdown of these instead of firing `onClick`. */
  menuItems?: PluginToolbarMenuItem[];
}

export const EditorToolbar = () => {
  const { t } = useTranslation();
  const { schemaId } = useAppState().document;
  const { disambiguationReview, translationMode } = useAppState().ui;
  const translationActive = translationMode.active;
  const { choiceDisplayMode, isReadonly, showBreaks, showNotes, showTags, textLocked } =
    useAppState().editor;
  // const { fullscreen } = useAppState().ui;

  const {
    cycleChoiceDisplayMode,
    toggleShowBreaks,
    toggleShowNotes,
    toggleShowTags,
    toggleTextLocked,
  } = useActions().editor;
  const { dismissReviewPanes, openDialog, showContextMenu, startDisambiguationReview } =
    useActions().ui;
  // Re-render when plugins load/unload so Norbert (etc.) appear without restart.
  const [pluginToolbarEpoch, setPluginToolbarEpoch] = useState(0);
  useEffect(() => {
    const onRegistryChanged = () => setPluginToolbarEpoch((n) => n + 1);
    window.addEventListener('grognardPluginRegistryChanged', onRegistryChanged);
    return () => window.removeEventListener('grognardPluginRegistryChanged', onRegistryChanged);
  }, []);
  const pluginToolbarItems = pluginToolbarEpoch >= 0 ? getPluginToolbarItems() : [];

  const openCalendarDialog = useCallback(
    (notice?: string) => {
      openDialog({
        type: 'calendar',
        props: {
          id: notice ? `calendar-${Date.now()}` : 'calendar',
          notice,
        },
      });
    },
    [openDialog],
  );

  const { entity } = useTheme();

  const container = useRef<HTMLDivElement>(null);

  const isSupported = useCallback(
    (name: EntityType) => window.writer.schemaManager.mapper.getEntitiesMapping().has(name),
    // `schemaId` is the invalidation signal, not an input: the mapping is read off
    // `window.writer`, which React cannot observe, so the id is what tells us the
    // schema changed. The rule calls it unnecessary because the body never
    // mentions it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaId],
  );

  // Desktop uses Enter (tag popup) and Alt+Enter (attributes) instead of entity shortcut buttons.
  const hideEntityShortcutButtons = isReadonly || isDesktopApp();

  const items: (MenuItem | Item)[] = [
    {
      group: 'action',
      hide: isReadonly || !isDesktopApp(),
      icon: textLocked ? 'lock' : 'lockOpen',
      onClick: () => toggleTextLocked(),
      selected: textLocked,
      title: textLocked ? t('LW.editorToolbar.Unlock Text') : t('LW.editorToolbar.Lock Text'),
      tooltip: textLocked
        ? t('LW.editorToolbar.Unlock Text tooltip')
        : t('LW.editorToolbar.Lock Text tooltip'),
      type: 'toggle',
    },
    {
      group: 'action',
      hide: isReadonly || isDesktopApp(),
      icon: 'insertTag',
      onClick: () => {
        if (!container.current) return;

        const rect = container.current.getBoundingClientRect();
        const posX = rect.left;
        const posY = rect.top + 34;

        showContextMenu({
          // anchorEl: container.current,
          eventSource: 'ribbon',
          position: { posX, posY },
          useSelection: true,
        });
      },
      title: t('LW.editorToolbar.Tag'),
      tooltip: t('LW.editorToolbar.Add Tag'),
      type: 'iconButton',
    },
    { group: 'action', type: 'divider', hide: hideEntityShortcutButtons },
    {
      color: entity.person.color.main,
      group: 'action',
      disabled: !isSupported('person'),
      hide: hideEntityShortcutButtons,
      icon: entity.person.icon,
      onClick: () => window.writer.tagger.addEntityDialog('person'),
      title: t('LW.editorToolbar.Tag Person'),
      type: 'iconButton',
    },
    {
      color: entity.place.color.main,
      group: 'action',
      disabled: !isSupported('place'),
      hide: hideEntityShortcutButtons,
      icon: entity.place.icon,
      onClick: () => window.writer.tagger.addEntityDialog('place'),
      title: t('LW.editorToolbar.Tag Place'),
      type: 'iconButton',
    },
    {
      color: entity.organization.color.main,
      group: 'action',
      disabled: !isSupported('organization'),
      hide: hideEntityShortcutButtons,
      icon: entity.organization.icon,
      onClick: () => window.writer.tagger.addEntityDialog('organization'),
      title: t('LW.editorToolbar.Tag Organization'),
      type: 'iconButton',
    },
    {
      color: entity.work.color.main,
      group: 'action',
      disabled: !isSupported('work'),
      hide: hideEntityShortcutButtons,
      icon: entity.work.icon,
      onClick: () => window.writer.tagger.addEntityDialog('work'),
      title: t('LW.editorToolbar.Tag Work'),
      type: 'iconButton',
    },
    {
      color: entity.thing.color.main,
      group: 'action',
      disabled: !isSupported('thing'),
      hide: hideEntityShortcutButtons,
      icon: entity.thing.icon,
      onClick: () => window.writer.tagger.addEntityDialog('thing'),
      title: t('LW.editorToolbar.Tag Thing'),
      type: 'iconButton',
    },
    {
      color: entity.citation.color.main,
      group: 'action',
      disabled: !isSupported('citation'),
      hide: hideEntityShortcutButtons,
      icon: entity.citation.icon,
      onClick: () => window.writer.tagger.addEntityDialog('citation'),
      title: t('LW.editorToolbar.Tag Citation'),
      type: 'iconButton',
    },
    {
      color: entity.note.color.main,
      group: 'action',
      disabled: !isSupported('note'),
      hide: hideEntityShortcutButtons,
      icon: entity.note.icon,
      onClick: () => window.writer.tagger.addEntityDialog('note'),
      title: t('LW.editorToolbar.Tag Note'),
      type: 'iconButton',
    },
    {
      color: entity.date.color.main,
      group: 'action',
      disabled: !isSupported('date'),
      hide: hideEntityShortcutButtons,
      icon: entity.date.icon,
      onClick: () => window.writer.tagger.addEntityDialog('date'),
      title: t('LW.editorToolbar.Tag Date'),
      type: 'iconButton',
    },
    {
      color: entity.correction.color.main,
      group: 'action',
      disabled: !isSupported('correction'),
      hide: hideEntityShortcutButtons,
      icon: entity.correction.icon,
      onClick: () => window.writer.tagger.addEntityDialog('correction'),
      title: t('LW.editorToolbar.Tag Correction'),
      type: 'iconButton',
    },
    {
      color: entity.keyword.color.main,
      group: 'action',
      disabled: !isSupported('keyword'),
      hide: hideEntityShortcutButtons,
      icon: entity.keyword.icon,
      onClick: () => window.writer.tagger.addEntityDialog('keyword'),
      title: t('LW.editorToolbar.Tag Keyword'),
      type: 'iconButton',
    },
    { group: 'action', type: 'divider', hide: hideEntityShortcutButtons },
    {
      group: 'action',
      disabled: !isSupported('correction'),
      hide: isReadonly,
      icon: 'toolCorrection',
      onClick: () => window.writer.tagger.addQuickCorrectionDialog(),
      title: t('LW.editorToolbar.Correction'),
      tooltip: t('LW.editorToolbar.Correction tooltip'),
      type: 'iconButton',
    },
    {
      group: 'action',
      disabled: !isSupported('correction'),
      hide: isReadonly,
      icon: CHOICE_DISPLAY_MODE_ICON[choiceDisplayMode],
      onClick: () => cycleChoiceDisplayMode(),
      title: t(
        `LW.editorToolbar.Correction Display: ${CHOICE_DISPLAY_MODE_LABEL[choiceDisplayMode]}`,
      ),
      tooltip: t('LW.editorToolbar.Correction Display tooltip'),
      type: 'iconButton',
    },
    { group: 'action', type: 'divider', hide: isReadonly },
    {
      group: 'ui',
      hide: isReadonly,
      icon: showBreaks ? 'showBreaksOn' : 'showBreaksOff',
      onClick: () => toggleShowBreaks(),
      selected: showBreaks,
      title: showBreaks ? t('LW.editorToolbar.Hide Breaks') : t('LW.editorToolbar.Show Breaks'),
      tooltip: showBreaks
        ? t('LW.editorToolbar.Hide Breaks tooltip')
        : t('LW.editorToolbar.Show Breaks tooltip'),
      type: 'toggle',
    },
    {
      group: 'ui',
      icon: showTags ? 'showTagsOn' : 'showTagsOff',
      onClick: () => toggleShowTags(),
      selected: showTags,
      title: showTags ? t('LW.editorToolbar.Hide Tags') : t('LW.editorToolbar.Show Tags'),
      type: 'toggle',
    },
    {
      group: 'ui',
      icon: showNotes ? 'toolHideNotes' : 'toolShowNotes',
      onClick: () => toggleShowNotes(),
      selected: showNotes,
      title: showNotes ? t('LW.editorToolbar.Hide Notes') : t('LW.editorToolbar.Show Notes'),
      tooltip: showNotes
        ? t('LW.editorToolbar.Hide Notes tooltip')
        : t('LW.editorToolbar.Show Notes tooltip'),
      type: 'toggle',
    },
    // {
    //   group: 'ui',
    //   icon: fullscreen ? 'fullscreenExit' : 'fullscreen',
    //   onClick: () => toggleFullscreen(),
    //   selected: fullscreen,
    //   title: t('LW.editorToolbar.Toggle Fullscreen'),
    //   type: 'toggle',
    // },
    { group: 'ui', type: 'divider', hide: isReadonly },
    {
      group: 'ui',
      hide: isReadonly || isDesktopApp(),
      icon: 'xpathSearch',
      onClick: () => openDialog({ type: 'xpathSearch' }),
      title: t('LW.xpathSearch.title'),
      type: 'iconButton',
    },
    {
      group: 'ui',
      hide: isReadonly,
      icon: 'structure',
      title: t('LW.editorToolbar.Structure'),
      tooltip: t('LW.editorToolbar.Structure tooltip'),
      type: 'menuButton',
      menuItems: [
        {
          id: 'structure-heading',
          label: t('LW.editorToolbar.Insert Heading'),
          onClick: () => {
            const writer = window.writer;
            if (writer) insertStructuralElementAtCursor(writer, 'head');
          },
        },
        {
          id: 'structure-page-break',
          label: t('LW.editorToolbar.Insert Page Break'),
          onClick: async () => {
            const writer = window.writer;
            if (!writer) return;
            const n = await promptForText(
              t('LW.editorToolbar.Insert Page Break'),
              t('LW.editorToolbar.Page Number'),
            );
            if (n === null) return;
            insertStructuralElementAtCursor(writer, 'pb', n ? { n } : {});
          },
        },
        {
          id: 'structure-line-break',
          label: t('LW.editorToolbar.Insert Line Break'),
          onClick: async () => {
            const writer = window.writer;
            if (!writer) return;
            const n = await promptForText(
              t('LW.editorToolbar.Insert Line Break'),
              t('LW.editorToolbar.Line Number'),
            );
            if (n === null) return;
            insertStructuralElementAtCursor(writer, 'lb', n ? { n } : {});
          },
        },
        {
          id: 'structure-split-paragraph',
          label: t('LW.editorToolbar.Split Paragraph'),
          onClick: () => {
            const writer = window.writer;
            if (writer) splitParagraphAtCursor(writer);
          },
        },
      ],
    },
    {
      group: 'ui',
      hide: isReadonly || translationActive,
      icon: 'TagPlus',
      onClick: () => openDialog({ type: 'autoTagging', props: { id: 'autoTagging' } }),
      title: 'Auto-tagging',
      type: 'iconButton',
    },
    {
      group: 'ui',
      hide: isReadonly || translationActive,
      icon: 'disambiguate',
      onClick: () => {
        // Already in disambiguate mode — clicking again used to dismiss and
        // immediately restart the review pane, which left the panel gone
        // and the flanking dock panels stuck unexpandable. Do nothing
        // instead; the user exits disambiguate mode from within the panel.
        if (disambiguationReview.active) return;
        // No launcher popup — start review directly. AI curation reflects the
        // panel's own persisted toggle (or 'Always on' from AI API settings),
        // same effective logic the old popup's Start button used to compute.
        const aiSettings = aiApiSettingsFromDesktop();
        const effectiveAiCuration =
          isAiUiFeatureEnabled('disambiguationCurate') &&
          isAiSuggestReady(aiSettings) &&
          (aiSettings?.alwaysOn === true ||
            (readPersistedDisambiguationSettings()?.aiCuration ?? false));
        dismissReviewPanes();
        startDisambiguationReview({ aiCuration: effectiveAiCuration });
      },
      title: 'Disambiguate',
      type: 'iconButton',
    },
    // {
    //   group: 'ui',
    //   hide: isReadonly,
    //   icon: 'validate',
    //   onClick: () => {
    //     window.writer.layoutManager.showModule('validation');
    //     window.writer.validate();
    //   },
    //   title: t('LW.editorToolbar.Validate'),
    //   type: 'iconButton',
    // },
    { group: 'ui', type: 'divider', hide: isReadonly || isDesktopApp() },
    {
      group: 'ui',
      hide: isReadonly || isDesktopApp(),
      icon: 'settings',
      onClick: () => openDialog({ type: 'settings' }),
      title: t('LW.editorToolbar.Settings'),
      type: 'iconButton',
    },
    {
      group: 'ui',
      hide: isDesktopApp(),
      icon: 'documentation',
      onClick: () => {
        window.open('https://www.leaf-vre.org/docs/documentation/leaf-writer-documentation');
      },
      title: t('LW.editorToolbar.Documentation'),
      type: 'iconButton',
    },
    {
      group: 'ui',
      hide: isReadonly,
      icon: 'toolTransform',
      onClick: () => openDialog({ type: 'tagTransform', props: { id: 'tagTransform' } }),
      title: 'Advanced tag transform',
      type: 'iconButton',
    },
    // Plugin-contributed items (e.g. the Norbert menu) render last, so a
    // newly-installed plugin's toolbar entry always lands at the end rather
    // than inserting itself into the middle of the built-in items above.
    ...pluginToolbarItems.map((item): MenuItem => {
      const isMenu = Boolean(item.menuItems?.length);
      const hideForTranslation = translationActive && item.id === 'calendar';
      return {
        group: item.group ?? 'ui',
        hide: isReadonly || !item.isAvailable() || hideForTranslation,
        icon: item.icon as IconLeafWriter,
        menuItems: isMenu ? item.menuItems : undefined,
        onClick: isMenu ? undefined : () => item.onClick?.({ openCalendar: openCalendarDialog }),
        title: item.title,
        tooltip: item.tooltip,
        type: isMenu ? 'menuButton' : 'iconButton',
      };
    }),
  ];

  const ItemComponent = (item: MenuItem | Item) => {
    const BUTTON_TYPES: Record<ItemType, React.ReactNode> = {
      button: <Button {...(item as MenuItem)} />,
      iconButton: <IconButton {...(item as MenuItem)} />,
      menuButton: (
        <MenuButton
          {...(item as MenuItem)}
          menuItems={(item as MenuItem).menuItems ?? []}
          openCalendar={openCalendarDialog}
        />
      ),
      toggle: <Toggle {...(item as MenuItem)} />,
      divider: (
        <Divider
          orientation="vertical"
          flexItem
          sx={{
            alignSelf: 'center',
            height: 18,
            mx: 0.25,
            borderColor: 'divider',
          }}
        />
      ),
    };
    return <>{BUTTON_TYPES[item.type]}</>;
  };

  const groups: ItemGroup[] = ['action', 'ui'];

  const toolbarItems = (
    <AnimatePresence mode="popLayout">
      {groups.map((group) => (
        <Stack key={group} direction="row" flexWrap="nowrap" gap={0.5}>
          {items
            .filter((item) => !item.hide)
            .filter((item) => item.group === group)
            .map((item, index) => (
              <Box
                layout
                key={'title' in item ? item.title : index}
                component={motion.div}
                initial={{ scale: 0, opacity: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                <ItemComponent {...item} />
              </Box>
            ))}
        </Stack>
      ))}
    </AnimatePresence>
  );

  if (isDesktopApp()) {
    const flatItems = items.filter((item) => !item.hide);
    return (
      <Stack
        ref={container}
        direction="row"
        flexWrap="nowrap"
        gap={0.25}
        px={0.5}
        alignItems="center"
        component={motion.div}
        layout="size"
        sx={{ height: '100%' }}
      >
        <AnimatePresence mode="popLayout">
          {flatItems.map((item, index) => (
            <Box
              layout
              key={'title' in item ? item.title : `toolbar-${index}`}
              component={motion.div}
              initial={{ scale: 0, opacity: 0 }}
              exit={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <ItemComponent {...item} />
            </Box>
          ))}
        </AnimatePresence>
      </Stack>
    );
  }

  return (
    <Paper
      ref={container}
      elevation={5}
      square
      sx={[
        {
          width: '100%',
          backgroundColor: '#f5f5f5',
        },
        (theme) =>
          theme.applyStyles('dark', {
            backgroundColor: theme.vars.palette.background.paper,
          }),
      ]}
      component={motion.div}
      layout="size"
    >
      <Stack
        direction="row"
        flexWrap="wrap"
        gap={0.25}
        px={0.5}
        py={0.25}
        component={motion.div}
        layout
        justifyContent="space-between"
      >
        {toolbarItems}
      </Stack>
    </Paper>
  );
};
