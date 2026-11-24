import { joinProjectPath } from '@src/desktop/projectFile';

export interface CssRuleSuggestion {
  tagName: string;
  attrName: string;
  attrValue: string;
}

const COMPOUND = /(\*|[A-Za-z_][\w:.-]*)((?:\[[^\]]*\])+)/g;
const ATTRIBUTE = /\[\s*([\w:.-]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\]\s]+))\s*(?:[is]\s*)?\]/g;

/**
 * Finds `tag[attr='value']` selectors (and `*[_tag='tag'][attr='value']`) in a stylesheet.
 * Only exact-match, single-attribute selectors qualify, since each maps to one appearance rule.
 */
export const extractAttributeSelectors = (css: string): CssRuleSuggestion[] => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Map<string, CssRuleSuggestion>();

  for (const [, preamble] of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selectorList = preamble!.trim();
    if (selectorList.startsWith('@')) continue;

    for (const selector of selectorList.split(',')) {
      for (const [, name, attributes] of selector.matchAll(COMPOUND)) {
        const attrs = [...attributes!.matchAll(ATTRIBUTE)].map((match) => ({
          name: match[1]!,
          value: match[2] ?? match[3] ?? match[4] ?? '',
        }));
        // Selectors with other operators (^=, ~=, existence checks) don't match the count.
        if (attrs.length !== (attributes!.match(/\[/g) ?? []).length) continue;

        let tagName = name!;
        let remaining = attrs;
        if (tagName === '*') {
          const tagAttr = attrs.find((attr) => attr.name === '_tag');
          if (!tagAttr) continue;
          tagName = tagAttr.value;
          remaining = attrs.filter((attr) => attr !== tagAttr);
        }
        if (remaining.length !== 1 || remaining[0]!.name.startsWith('_')) continue;

        const { name: attrName, value: attrValue } = remaining[0]!;
        found.set(`${tagName}\u0000${attrName}\u0000${attrValue}`, {
          tagName,
          attrName,
          attrValue,
        });
      }
    }
  }

  return [...found.values()];
};

export const loadCssRuleSuggestions = async (
  rootPath: string,
  cssRelativePath?: string,
): Promise<CssRuleSuggestion[]> => {
  if (!cssRelativePath || !window.electronAPI?.readFile) return [];
  try {
    const css = await window.electronAPI.readFile(joinProjectPath(rootPath, cssRelativePath));
    return extractAttributeSelectors(css);
  } catch {
    return [];
  }
};
