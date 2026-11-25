import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktop } from '@src/types/desktop';
import { useActions } from '@src/overmind';
import { AttributeCommandPopup } from './AttributeCommandPopup';
import {
  registerDesktopTaggingBridge,
  unregisterDesktopTaggingBridge,
} from './desktopTaggingBridge';
import { TagCommandPopup } from './TagCommandPopup';
import { TagWalkToolbar } from './TagWalkToolbar';
import { applyRenameTag } from './tagCommand';
import { useAttributeCommandController } from './useAttributeCommandController';
import { useTagCommandController } from './useTagCommandController';

export const TagCommandProvider = () => {
  const { t } = useTranslation();
  const tagController = useTagCommandController();
  const attrController = useAttributeCommandController();
  const { notifyViaSnackbar } = useActions().ui;

  const changeTag = useCallback(
    (tagId: string, newTagName: string) => {
      const writer = window.writer;
      if (!writer?.tagger) return;

      const $tag = writer.tagger.getCurrentTag(tagId);
      const element = ($tag?.[0] as Element | undefined) ?? null;
      if (!element) {
        notifyViaSnackbar({
          message: t('LWC.desktop.tagging.tag_not_found'),
          options: { variant: 'warning' },
        });
        return;
      }

      void applyRenameTag(newTagName, element).then((result) => {
        if (result.applied) {
          writer.layoutManager?.showModule('attributes');
          return;
        }
        if (result.error && result.error !== 'Cancelled') {
          notifyViaSnackbar({ message: result.error, options: { variant: 'warning' } });
        }
      });
    },
    [notifyViaSnackbar, t],
  );

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (attrController.open) return false;

      const tagHandled = tagController.handleEditorKeyDown(event);
      const attrHandled = tagHandled
        ? false
        : attrController.handleEditorKeyDown(event, {
            tagPopupOpen: tagController.open,
            walkMode: Boolean(tagController.walkMode),
          });
      const handled = tagHandled || attrHandled;

      return handled;
    },
    // Deliberately depends on the individual controller members rather than the
    // whole `attrController`/`tagController` objects the rule asks for: both are
    // rebuilt by their hooks on every render, so depending on the objects would
    // rebuild this callback every render and defeat the memoisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      attrController.handleEditorKeyDown,
      attrController.open,
      tagController.handleEditorKeyDown,
      tagController.open,
      tagController.walkMode,
    ],
  );

  useEffect(() => {
    if (!isDesktop()) return;

    registerDesktopTaggingBridge({
      changeTag,
      handleEditorKeyDown,
      isPopupOpen: () => tagController.open || attrController.open,
      openTagPopup: (mode, anchorOverride) => tagController.openPopup(mode, anchorOverride),
      openAttributePopup: (anchorOverride) => attrController.openPopup(anchorOverride),
    });

    return () => unregisterDesktopTaggingBridge();
    // Same reasoning as `handleEditorKeyDown` above — member-level deps, not the
    // whole controller objects, which change identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    attrController.open,
    attrController.openPopup,
    changeTag,
    handleEditorKeyDown,
    tagController.open,
    tagController.openPopup,
  ]);

  return (
    <>
      <TagCommandPopup
        anchor={tagController.anchor}
        filter={tagController.filter}
        highlightedIndex={tagController.highlightedIndex}
        matchCount={tagController.matchCount}
        mode={tagController.mode}
        onApplyPropagate={tagController.onApplyPropagate}
        onApplySingle={tagController.onApplySingle}
        onApplyTag={tagController.onApplyTag}
        onApplyPluginTagCommand={tagController.onApplyPluginTagCommand}
        onEnterWalkMode={tagController.onEnterWalkMode}
        onClose={tagController.closePopup}
        onFilterChange={tagController.setFilter}
        onHighlightChange={tagController.setHighlightedIndex}
        onPopupKeyDown={tagController.handlePopupKeyDown}
        open={tagController.open}
        selectedText={tagController.selectedText}
        suggestions={tagController.suggestions}
        pluginItems={tagController.pluginItems}
      />
      <AttributeCommandPopup
        anchor={attrController.anchor}
        focusedField={attrController.focusedField}
        highlightedIndex={attrController.highlightedIndex}
        nameFilter={attrController.nameFilter}
        nameIsPrefill={attrController.nameIsPrefill}
        onClose={attrController.closePopup}
        onFocusedFieldChange={attrController.setFocusedField}
        onHighlightChange={attrController.setHighlightedIndex}
        onNameFilterChange={attrController.setNameFilter}
        onPopupKeyDown={attrController.handlePopupKeyDown}
        onValueFilterChange={attrController.setValueFilter}
        open={attrController.open}
        schemaAttributes={attrController.schemaAttributes}
        tagName={attrController.tagName}
        valueFilter={attrController.valueFilter}
        valueHighlightedIndex={attrController.valueHighlightedIndex}
        valueSuggestions={attrController.valueSuggestions}
      />
      {tagController.walkMode ? (
        <TagWalkToolbar
          matchCount={tagController.walkMode.matchCount}
          mode={tagController.walkMode.mode}
          onApplyStep={tagController.onApplyWalkStep}
          onExit={tagController.exitWalkMode}
          onSkip={tagController.onSkipWalkStep}
          searchText={tagController.walkMode.search}
          tagName={tagController.walkMode.tagName}
        />
      ) : null}
    </>
  );
};
