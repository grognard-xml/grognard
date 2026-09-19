import type {
  NodeDetail,
  Target as PossibleNodesAtTarget,
  TargetSelection as PossibleNodesAtTargetSelection,
} from '@cwrc/leafwriter-validator';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { IconLeafWriter } from '../../../icons';
import { collectSelectedUnitIds, copyUnitsForExport } from '../../../js/conversion/copyForExport';
import type { Action } from '../../../js/tagger';
import { useActions, useAppState } from '../../../overmind';
import type { EntityType } from '../../../types';
import { log } from '../../../utilities';
import { pickImageFile } from '../../../utilities/clipboardImage';
import { replaceGlyphImage, resolveGlyphContext } from '../../../utilities/glyphEditor';
import {
  graphicHeightEm,
  replaceKanripoGaijiImage,
  resolveKanripoGaijiContext,
  updateKanripoGaijiHeight,
} from '../../../utilities/kanripoGaijiEditor';
import type { ItemProps } from '../components';
import { State } from './useContextmenu';

export const useItems = (ctx: State) => {
  const { writer } = window;

  const { isAnnotator } = useAppState().editor;
  const { translationMode } = useAppState().ui;

  const { notifyViaSnackbar, openDialog } = useActions().ui;
  const { getPossibleNodesAt } = useActions().validator as {
    getPossibleNodesAt: (params: PossibleNodesAtTarget) => Promise<NodeDetail[] | undefined>;
  };

  const { t } = useTranslation();

  const getEntitiesOptions = () => {
    const type = 'entity';
    const entityMappings = writer.schemaManager.mapper.getMappings().entities;

    const options = [...entityMappings].map(([key, { label }]: [EntityType, { label: string }]) => {
      const item: ItemProps = {
        id: key,
        type,
        name: label,
        icon: key as IconLeafWriter,
        onClick: () => writer.tagger.addEntityDialog(key),
      };
      return item;
    });

    return options;
  };

  const paramsForAddTag = () => {
    if (!ctx.rng || !ctx.element) return;
    const { rng } = ctx;

    const xpath = writer.utilities.getElementXPath(ctx.element);
    if (!xpath) return;

    const elementChildren = Array.from(ctx.element.childNodes);
    const index = elementChildren.findIndex((child) => child === rng.startContainer);

    const request: PossibleNodesAtTarget = { xpath, index };

    if (ctx.hasContentSelection) {
      request.selection = {
        type: 'span',
        startContainerIndex: index,
        startOffset: rng.startOffset,
        endContainerIndex: elementChildren.findIndex((child) => child === rng.endContainer),
        endOffset: rng.endOffset,
      };
    }

    return request;
  };

  const paramsForChangeTag = () => {
    if (!writer || !ctx.element?.parentNode) return;

    const parentNode = ctx.element.parentNode as Element;

    const xpath = writer.utilities.getElementXPath(parentNode);
    if (!xpath) return;

    const elementChildren = Array.from(ctx.element.parentNode.childNodes);
    const index = elementChildren.findIndex((child) => child === ctx.element);
    const skip = ctx.element.getAttribute('_tag') ?? undefined;

    const selectionXpath = writer.utilities.getElementXPath(ctx.element);

    const selection: PossibleNodesAtTargetSelection = {
      type: 'change',
      xpath: selectionXpath ?? '',
      startContainerIndex: 0,
      endContainerIndex: elementChildren.length,
      skip,
    };

    const request: PossibleNodesAtTarget = { xpath, index, selection };

    return request;
  };

  const paramsForAddTagBefore = () => {
    if (!writer || !ctx.element?.parentNode) return;

    const parentNode = ctx.element.parentNode as Element;
    const xpath = writer.utilities.getElementXPath(parentNode);
    if (!xpath) return;

    const index = 0;

    const elementChildren = Array.from(ctx.element.parentNode.childNodes);
    let containerIndex = elementChildren.findIndex((child) => child === ctx.element) - 1;
    if (containerIndex < 0) containerIndex = 0;

    const selection: PossibleNodesAtTargetSelection = { type: 'before', xpath, containerIndex };
    const request: PossibleNodesAtTarget = { xpath, index, selection };

    return request;
  };

  const paramsForAddTagAfter = () => {
    if (!writer || !ctx.element?.parentNode) return;

    const parentNode = ctx.element.parentNode as Element;
    const xpath = writer.utilities.getElementXPath(parentNode);
    if (!xpath) return;

    const elementChildren = Array.from(ctx.element.parentNode.childNodes);
    const index = elementChildren.findIndex((child) => child === ctx.element) + 1;

    const selection: PossibleNodesAtTargetSelection = {
      type: 'after',
      xpath,
      containerIndex: index,
    };
    const request: PossibleNodesAtTarget = { xpath, index, selection };

    return request;
  };

  const paramsForAddTagAround = () => {
    if (!writer || !ctx.element?.parentNode) return;

    const parentNode = ctx.element.parentNode as Element;
    const xpath = writer.utilities.getElementXPath(parentNode);
    if (!xpath) return;

    const elementChildren = Array.from(ctx.element.parentNode.childNodes);
    const index = elementChildren.findIndex((child) => child === ctx.element);

    const selectionXpath = writer.utilities.getElementXPath(ctx.element);

    const selection: PossibleNodesAtTargetSelection = {
      type: 'around',
      xpath: selectionXpath ?? '',
    };
    const request: PossibleNodesAtTarget = { xpath, index, selection };

    return request;
  };

  const paramsForAddTagInside = () => {
    if (!writer || !ctx.element) return;

    const xpath = writer.utilities.getElementXPath(ctx.element);
    if (!xpath) return;

    const index = 0;
    const selectionXpath = writer.utilities.getElementXPath(ctx.element);

    const selection: PossibleNodesAtTargetSelection = {
      type: 'inside',
      xpath: selectionXpath ?? '',
    };
    const request: PossibleNodesAtTarget = { xpath, index, selection };

    return request;
  };

  const getTagsFor = async (params: PossibleNodesAtTarget) => {
    const tags = await getPossibleNodesAt(params);
    if (!tags) return [];
    return tags;
  };

  const getTagItems = (tags: NodeDetail[], action: Action) => {
    if (!writer) return;

    const menu = tags.map(({ name, fullName, invalid, documentation }) => {
      const item: ItemProps = {
        documentation,
        fullName,
        name,
        id: nanoid(),
        onClick: () => {
          if (!writer.editor) return;

          if (ctx.tagId === undefined) return log.warn('No Tag selected');
          writer.editor.currentBookmark = writer.editor?.selection.getBookmark(1);

          if (action === 'change') {
            if (window.__desktopTagging?.changeTag && ctx.tagId && typeof ctx.tagId === 'string') {
              window.__desktopTagging.changeTag(ctx.tagId, name);
              return;
            }
            writer.tagger.changeTagDialog(name, ctx.tagId);
            return;
          }

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          //@ts-expect-error
          writer.editor.currentBookmark.tagId = ctx.tagId;
          writer.tagger.addTagDialog({
            tagName: name,
            tagFullname: fullName,
            action,
            parentTagId: ctx.tagId,
          });
        },
        invalid,
        type: 'tag',
      };
      return item;
    });

    return menu;
  };

  const getItems = async () => {
    if (ctx.isHeader) {
      const items: ItemProps[] = [
        {
          id: nanoid(),
          type: 'action',
          name: t('LW.Edit Header'),
          icon: 'edit',
          onClick: () => {
            const header = writer.editor
              ?.getBody()
              .querySelector(`[_tag="${writer.schemaManager.getHeader()}"]`);

            if (!header) return;

            const content = writer.converter.buildXMLString(header);

            openDialog({
              type: 'editSource',
              props: { content, type: 'header' },
            });
          },
        },
      ];
      return items;
    }

    if (ctx.isRoot) {
      const items: ItemProps[] = [
        {
          id: nanoid(),
          name: t('LW.commons.edit'),
          type: 'action',
          onClick: () => {
            if (!ctx.tagId) return;
            if (window.__desktopTagging) {
              writer.layoutManager?.showModule('attributes');
              return;
            }
            writer.tagger.editTagDialog(ctx.tagId);
          },
        },
      ];
      return items;
    }

    if (ctx.eventSource === 'ribbon') {
      const params = paramsForAddTag();
      if (!params) return [];
      const tags = await getTagsFor(params);
      const items = getTagItems(tags, 'add');
      return items;
    }

    if (isAnnotator) {
      const items = getEntitiesOptions();
      return items;
    }

    if (!ctx.tagId) return [];

    const items: ItemProps[] = [];

    if (ctx.isMultiple) {
      items.push({
        type: 'collection',
        name: t('LW.Add Tag Around'),
        icon: 'add',
        getChildren: async () => {
          const params = paramsForAddTagAround();
          if (!params) return [];
          const tags = await getTagsFor(params);
          const items = getTagItems(tags, 'around');
          return items ? items : [];
        },
      });

      items.push({ type: 'divider', name: 'divider' });

      if (Array.isArray(ctx.tagId)) {
        items.push({
          type: 'action',
          name: t('LW.Merge Tags'),
          icon: 'merge',
          disabled: !ctx.allowsMerge,
          onClick: () => {
            if (!Array.isArray(ctx.tagId)) return;
            writer.tagger.mergeTags(ctx.tagId);
          },
        });
      }

      return items;
    }

    if (ctx.useSelection && ctx.allowsTagAround) {
      items.push({
        type: 'collection',
        name: t('LW.Add Tag'),
        icon: 'add',
        getChildren: async () => {
          const params = paramsForAddTag();
          if (!params) return [];
          const tags = await getTagsFor(params);
          const items = getTagItems(tags, 'add');
          return items ? items : [];
        },
      });

      // 'Add Entity Annotation' removed from the context menu — entity linking is
      // handled by the auto-tagging/disambiguation workflow instead.
      // if (writer.schemaManager.isSchemaCustom() === false) {
      //   items.push({
      //     type: 'collection',
      //     name: t('LW.Add Entity Annotation'),
      //     icon: 'add',
      //     searchable: false,
      //     children: getEntitiesOptions(),
      //   });
      // }

      items.push({ type: 'divider', name: 'divider' });
    }

    if (!ctx.useSelection) {
      items.push({
        type: 'collection',
        name: t('LW.Add Tag Before'),
        icon: 'add',
        getChildren: async () => {
          const params = paramsForAddTagBefore();
          if (!params) return [];
          const tags = await getTagsFor(params);
          const items = getTagItems(tags, 'before');
          return items ? items : [];
        },
      });

      items.push({
        type: 'collection',
        name: t('LW.Add Tag After'),
        icon: 'add',
        getChildren: async () => {
          const params = paramsForAddTagAfter();
          if (!params) return [];
          const tags = await getTagsFor(params);
          const items = getTagItems(tags, 'after');
          return items ? items : [];
        },
      });

      items.push({
        type: 'collection',
        name: t('LW.Add Tag Around'),
        icon: 'add',
        getChildren: async () => {
          const params = paramsForAddTagAround();
          if (!params) return [];
          const tags = await getTagsFor(params);
          const items = getTagItems(tags, 'around');

          return items ? items : [];
        },
      });

      if (ctx.nodeType !== 'text') {
        items.push({
          type: 'collection',
          name: t('LW.Add Tag Inside'),
          icon: 'add',
          getChildren: async () => {
            const params = paramsForAddTagInside();
            if (!params) return [];
            const tags = await getTagsFor(params);
            const items = getTagItems(tags, 'inside');
            return items ? items : [];
          },
        });
      }

      items.push({ type: 'divider', name: 'divider' });
    }

    const kanripoGaiji = ctx.element ? resolveKanripoGaijiContext(ctx.element) : null;
    if (kanripoGaiji && !ctx.isEntity) {
      const currentHeight = graphicHeightEm(kanripoGaiji.graphicElement, writer).replace(/em$/, '');
      items.push({
        type: 'action',
        name: t('LW.Set Kanripo gaiji height'),
        icon: 'edit',
        onClick: () => {
          const next = window.prompt(t('LW.Height in em (e.g. 1 or 1.5)'), currentHeight);
          if (!next) return;
          const parsed = parseFloat(next.trim());
          if (!Number.isFinite(parsed) || parsed <= 0) {
            notifyViaSnackbar(t('LW.Enter a positive number.'));
            return;
          }
          updateKanripoGaijiHeight(writer, kanripoGaiji.graphicElement, `${parsed}em`);
        },
      });
      items.push({
        type: 'action',
        name: t('LW.Replace Kanripo gaiji image'),
        icon: 'edit',
        onClick: async () => {
          const file = await pickImageFile();
          if (!file) return;
          const replaced = await replaceKanripoGaijiImage(
            writer,
            kanripoGaiji.graphicElement,
            file,
          );
          if (!replaced) {
            notifyViaSnackbar(t('LW.Could not save the new gaiji image.'));
          }
        },
      });
      items.push({ type: 'divider', name: 'divider' });
    }

    const glyph = ctx.element ? resolveGlyphContext(ctx.element) : null;
    if (glyph && !ctx.isEntity) {
      items.push({
        type: 'action',
        name: t('LW.Replace glyph image'),
        icon: 'edit',
        onClick: async () => {
          const file = await pickImageFile();
          if (!file) return;
          const replaced = await replaceGlyphImage(writer, glyph, file);
          if (!replaced) {
            notifyViaSnackbar(t('LW.Could not save the new glyph image.'));
          }
        },
      });
      items.push({ type: 'divider', name: 'divider' });
    }

    if (ctx.nodeType !== 'text') {
      items.push({
        type: 'action',
        name: ctx.isEntity ? t('LW.Edit Entity Annotation') : t('LW.Edit Tag'),
        icon: 'edit',
        onClick: () => {
          if (!ctx.tagId) return;
          if (window.__desktopTagging && !ctx.isEntity) {
            writer.layoutManager?.showModule('attributes');
            return;
          }
          writer.tagger.editTagDialog(ctx.tagId);
        },
      });
    }

    if (!ctx.isEntity && ctx.element && ctx.nodeType !== 'text') {
      const tagName = ctx.element.getAttribute('_tag');
      if (tagName && writer.schemaManager.isTagEntity(tagName)) {
        items.push({
          type: 'action',
          name: t('LW.Convert to Entity Annotation'),
          icon: 'edit',
          onClick: () => {
            if (ctx.element) {
              return writer.schemaManager.mapper.convertTagToEntity(ctx.element, true);
            }
          },
        });
      }
    }

    if (
      (!ctx.useSelection && ctx.nodeType !== 'text') ||
      (ctx.useSelection && !ctx.hasContentSelection)
    ) {
      items.push({
        type: 'collection',
        name: t('LW.Change Tag'),
        icon: 'edit',
        getChildren: async () => {
          const params = paramsForChangeTag();
          if (!params) return [];
          const tags = await getTagsFor(params);
          const items = getTagItems(tags, 'change');
          return items ? items : [];
        },
      });
    }

    if (translationMode.active && translationMode.alignmentUnit) {
      items.push({
        type: 'action',
        name: t('LW.Copy Source and Translation'),
        icon: 'copy',
        onClick: async () => {
          const alignmentUnit = translationMode.alignmentUnit;
          if (!alignmentUnit) return;
          const unitIds = collectSelectedUnitIds(writer, alignmentUnit);
          try {
            await copyUnitsForExport({
              translationMode: {
                alignmentUnit,
                sourcePath: translationMode.sourcePath,
                translationPath: translationMode.translationPath,
              },
              unitIds,
              notify: (message) => notifyViaSnackbar(message),
            });
          } catch (error) {
            notifyViaSnackbar(
              `Copy failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      });
    }

    if (ctx.nodeType === 'text') {
      items.push({
        type: 'action',
        name: t('LW.Copy Content'),
        icon: 'copy',
        onClick: async () => {
          if (!ctx.xpath || !writer.editor) return;

          const node = writer.utilities.evaluateXPath(writer.editor.getBody(), ctx.xpath);
          if (node === null) return;

          const content = typeof node === 'object' ? node.textContent : node.toString();
          if (!content || content === '') return;

          const permission = await navigator.permissions.query({
            name: 'clipboard-write' as PermissionName,
          });
          if (permission.state == 'granted' || permission.state == 'prompt') {
            await navigator.clipboard.writeText(content);
          }
        },
      });
    } else {
      items.push({
        type: 'action',
        name: ctx.isEntity ? t('LW.Copy Entity') : t('LW.Copy Tag and Contents'),
        icon: 'copy',
        onClick: () => ctx.tagId && writer.tagger.copyTag(ctx.tagId),
      });
    }

    if (ctx.nodeType === 'text') {
      items.push({
        type: 'action',
        name: t('LW.Paste Content'),
        icon: 'paste',
        onClick: async () => {
          if (!ctx.xpath || !writer.editor) return;

          const node = writer.utilities.evaluateXPath(writer.editor.getBody(), ctx.xpath);
          if (node === null || typeof node !== 'object') return;

          const permission = await navigator.permissions.query({
            name: 'clipboard-read' as PermissionName,
          });
          if (permission.state == 'granted' || permission.state == 'prompt') {
            const content = await navigator.clipboard.readText();
            node.textContent = content;
          }
        },
      });
    } else {
      if (writer.editor?.copiedElement?.element !== undefined) {
        items.push({
          type: 'action',
          name: t('LW.Paste Tag'),
          icon: 'paste',
          onClick: () => writer.tagger.pasteTag(),
        });
      } else if (writer.editor?.copiedEntity !== undefined) {
        items.push({
          type: 'action',
          name: t('LW.Paste Entity'),
          icon: 'paste',
          onClick: () => writer.tagger.pasteEntity(),
        });
      }
    }

    if (ctx.useSelection) {
      items.push({
        type: 'action',
        name: t('LW.Split Tag'),
        icon: 'split',
        onClick: () => writer.tagger.splitTag(),
      });
    }

    items.push({ type: 'divider', name: 'divider' });

    if (ctx.nodeType === 'text') {
      items.push({
        type: 'action',
        name: t('LW.Remove Content'),
        icon: 'remove',
        onClick: () => {
          if (!ctx.xpath) return;
          writer.tagger.removeNodeTextContent(ctx.xpath);
        },
      });
      items.push({
        type: 'action',
        name: t('LW.Remove Node'),
        icon: 'remove',
        onClick: () => {
          if (!ctx.xpath) return;
          writer.tagger.removeNodeText(ctx.xpath);
        },
      });
    } else {
      if (ctx.isEntity) {
        items.push({
          type: 'action',
          name: t('LW.Remove Entity'),
          icon: 'remove',
          onClick: () => writer.tagger.removeEntity(ctx.tagId),
        });
      }

      items.push({
        type: 'action',
        name: t('LW.Remove Tag'),
        icon: 'remove',
        onClick: () => ctx.tagId && writer.tagger.removeStructureTag(ctx.tagId, false),
      });

      items.push({
        type: 'action',
        name: t('LW.Remove Content Only'),
        icon: 'remove',
        onClick: () => ctx.tagId && writer.tagger.removeStructureTagContents(ctx.tagId),
      });

      items.push({
        type: 'action',
        name: t('LW.Remove All'),
        icon: 'remove',
        onClick: () => ctx.tagId && writer.tagger.removeStructureTag(ctx.tagId, true),
      });
    }

    if (ctx.eventSource === 'markupPanel') {
      //? Not until we develp better support for textNodes
      // items.push({ type: 'divider', name: 'divider' });
      // items.push({
      //   type: 'action',
      //   name: t('LW.Show Text Nodes'),
      //   icon: markupPanel.showTextNodes ? 'checkIcon' : undefined,
      //   onClick: () => showTextNodes(),
      // });
    }

    return items;
  };

  return {
    getItems,
  };
};
