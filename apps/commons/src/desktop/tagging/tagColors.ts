import { joinProjectPath } from '@src/desktop/projectFile';

export const TAG_COLORS_RELATIVE_PATH = 'schema/tag-colors.json';
export const TAG_COLORS_CSS_RELATIVE_PATH = 'schema/tag-colors.css';

export interface TagColorEntry {
  highlight?: string;
  text?: string;
  highlightEnabled?: boolean;
  textEnabled?: boolean;
}

export interface TagColorsFile {
  version: 1;
  tags: Record<string, TagColorEntry>;
}

const DEFAULT_TAG_COLORS: Record<string, TagColorEntry> = {
  persName: { highlight: '#e8f4fc', text: '#1a5276' },
  placeName: { highlight: '#eafaf1', text: '#186a3b' },
  date: { highlight: '#fef9e7', text: '#7d6608' },
  orgName: { highlight: '#f4ecf7', text: '#512e5f' },
  title: { highlight: '#fdebd0', text: '#784212' },
};

/**
 * Rule keys let one tag carry several appearances depending on an attribute value:
 * `persName` is the plain tag rule, `persName[type=author]` applies only when
 * the element has `type="author"`.
 */
export interface TagRuleKey {
  tagName: string;
  attrName?: string;
  attrValue?: string;
}

export const makeTagRuleKey = (tagName: string, attrName?: string, attrValue?: string): string =>
  attrName ? `${tagName}[${attrName}=${attrValue ?? ''}]` : tagName;

export const parseTagRuleKey = (key: string): TagRuleKey => {
  const match = /^([^[\]]+)\[([^=\]]+)=([\s\S]*)\]$/.exec(key);
  if (!match) return { tagName: key };
  return { tagName: match[1]!, attrName: match[2]!, attrValue: match[3]! };
};

const cssString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Attribute rules for one tag, in file order. */
export const getAttributeRuleKeys = (file: TagColorsFile, tagName: string): string[] =>
  Object.keys(file.tags).filter((key) => {
    const parsed = parseTagRuleKey(key);
    return parsed.tagName === tagName && parsed.attrName !== undefined;
  });

export const emptyTagColorsFile = (): TagColorsFile => ({
  version: 1,
  tags: {},
});

export const getTagColorsPath = (rootPath: string) =>
  joinProjectPath(rootPath, TAG_COLORS_RELATIVE_PATH);

export const getTagColorsCssPath = (rootPath: string) =>
  joinProjectPath(rootPath, TAG_COLORS_CSS_RELATIVE_PATH);

export const getDefaultTagColor = (tagName: string): TagColorEntry | undefined =>
  DEFAULT_TAG_COLORS[tagName];

export const normalizeTagColorEntry = (entry?: TagColorEntry | null): TagColorEntry | undefined => {
  if (!entry) return undefined;
  const normalized: TagColorEntry = {};
  if (entry.highlight) normalized.highlight = entry.highlight;
  if (entry.text) normalized.text = entry.text;
  if (entry.highlightEnabled === false) normalized.highlightEnabled = false;
  if (entry.textEnabled === false) normalized.textEnabled = false;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const resolveTagColor = (file: TagColorsFile, tagName: string): TagColorEntry | undefined =>
  normalizeTagColorEntry(file.tags[tagName]) ?? normalizeTagColorEntry(getDefaultTagColor(tagName));

const parseHex = (hex: string): [number, number, number] | null => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Blend two hex colours; weight 0 = a, 1 = b. */
export const mixHex = (a: string, b: string, weight: number): string => {
  const left = parseHex(a);
  const right = parseHex(b);
  if (!left || !right) return a;
  return toHex(
    left[0] + (right[0] - left[0]) * weight,
    left[1] + (right[1] - left[1]) * weight,
    left[2] + (right[2] - left[2]) * weight,
  );
};

/** WCAG relative luminance for sRGB hex (0 = black, 1 = white). */
export const relativeLuminance = (hex: string): number => {
  const rgb = parseHex(hex);
  if (!rgb) return 0.5;

  const channel = (value: number) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };

  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two sRGB colours. */
export const contrastRatio = (foreground: string, background: string): number => {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

/** Pick black or white label text for readable contrast on a pill background. */
export const contrastTextOn = (background: string): '#000000' | '#ffffff' => {
  const onWhite = contrastRatio('#ffffff', background);
  const onBlack = contrastRatio('#000000', background);
  return onWhite >= onBlack ? '#ffffff' : '#000000';
};

/** Darker pill colours derived from the assigned highlight (same hue family). */
export const pillColorsFromEntry = (
  colors: TagColorEntry,
): { background?: string; text?: string } => {
  const highlight = colors.highlightEnabled === false ? undefined : colors.highlight;
  const text = colors.textEnabled === false ? undefined : colors.text;
  if (!highlight && !text) return {};

  const background = highlight
    ? mixHex(highlight, text ?? '#000000', text ? 0.58 : 0.42)
    : undefined;
  const pillText = background ? contrastTextOn(background) : undefined;

  return { background, text: pillText };
};

export const generateTagColorsCss = (file: TagColorsFile): string => {
  const mergedTags = { ...DEFAULT_TAG_COLORS, ...file.tags };
  const lines = ['/* Generated from schema/tag-colors.json — do not edit by hand */'];

  // Plain tag rules first so attribute rules, which come later, win on equal specificity.
  const keys = Object.keys(mergedTags).sort(
    (a, b) =>
      Number(parseTagRuleKey(a).attrName !== undefined) -
      Number(parseTagRuleKey(b).attrName !== undefined),
  );

  for (const key of keys) {
    const { tagName, attrName, attrValue } = parseTagRuleKey(key);
    const normalized = normalizeTagColorEntry(mergedTags[key]);
    if (!normalized) continue;
    const highlight = normalized.highlightEnabled === false ? undefined : normalized.highlight;
    const text = normalized.textEnabled === false ? undefined : normalized.text;
    if (!highlight && !text) continue;

    const base = `*[_tag='${tagName}']`;
    // :where() keeps descendants at the same specificity as plain tag rules.
    const descendantBase =
      attrName === undefined
        ? base
        : `${base}:where([${attrName}='${cssString(attrValue ?? '')}'])`;
    const selfBase =
      attrName === undefined ? base : `${base}[${attrName}='${cssString(attrValue ?? '')}']`;
    const selector = `${selfBase}, ${descendantBase} *`;
    const rules: string[] = ['box-decoration-break: clone', '-webkit-box-decoration-break: clone'];
    if (highlight) rules.push(`background-color: ${highlight}`);
    if (text) rules.push(`color: ${text} !important`);
    lines.push(`${selector} { ${rules.join('; ')}; }`);

    const pill = pillColorsFromEntry(normalized);
    if (pill.background || pill.text) {
      const pillRules: string[] = [];
      if (pill.background) pillRules.push(`background-color: ${pill.background}`);
      if (pill.text) pillRules.push(`color: ${pill.text} !important`);
      const pillSelector = [
        `.showTags ${selfBase}:before`,
        `.showTags ${selfBase}:after`,
        `.showTags ${descendantBase} *[_tag]:before`,
        `.showTags ${descendantBase} *[_tag]:after`,
      ].join(', ');
      lines.push(`${pillSelector} { ${pillRules.join('; ')}; }`);
    }
  }

  return `${lines.join('\n')}\n`;
};

export const loadTagColors = async (rootPath: string): Promise<TagColorsFile> => {
  if (!window.electronAPI?.readFile) return emptyTagColorsFile();

  const colorsPath = getTagColorsPath(rootPath);
  try {
    if (window.electronAPI.pathExists && !(await window.electronAPI.pathExists(colorsPath))) {
      return emptyTagColorsFile();
    }
    const raw = await window.electronAPI.readFile(colorsPath);
    const parsed = JSON.parse(raw) as TagColorsFile;
    return {
      version: 1,
      tags: Object.fromEntries(
        Object.entries(parsed.tags ?? {})
          .map(([tagName, entry]) => [tagName, normalizeTagColorEntry(entry)])
          .filter((entry): entry is [string, TagColorEntry] => Boolean(entry[1])),
      ),
    };
  } catch {
    return emptyTagColorsFile();
  }
};

export const saveTagColors = async (rootPath: string, file: TagColorsFile): Promise<void> => {
  if (!window.electronAPI?.writeFile) return;
  await window.electronAPI.writeFile(getTagColorsPath(rootPath), JSON.stringify(file, null, 2));
};

export const saveGeneratedTagColorsCss = async (rootPath: string, css: string): Promise<void> => {
  if (!window.electronAPI?.writeFile) return;
  await window.electronAPI.writeFile(getTagColorsCssPath(rootPath), css);
};

const tagColorsCssCache = new Map<string, string>();

export const reapplyCachedTagColors = (rootPath: string): boolean => {
  const css = tagColorsCssCache.get(rootPath);
  if (!css) return false;
  return injectTagColorsCss(css);
};

export const injectTagColorsCss = (css: string): boolean => {
  const doc = window.writer?.editor?.getDoc();
  if (!doc) return false;

  let style = doc.getElementById('tagColors') as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = 'tagColors';
    style.type = 'text/css';
    doc.head?.appendChild(style);
  }
  style.textContent = css;
  return true;
};

const cacheAndInjectTagColors = (rootPath: string, css: string): void => {
  tagColorsCssCache.set(rootPath, css);
  injectTagColorsCss(css);
};

export const scheduleTagColorsInjection = (rootPath: string): void => {
  void loadAndInjectTagColors(rootPath).then(() => {
    if (reapplyCachedTagColors(rootPath)) return;

    let attempts = 0;
    const retry = () => {
      if (reapplyCachedTagColors(rootPath) || attempts >= 20) return;
      attempts += 1;
      window.setTimeout(retry, 100);
    };
    retry();
  });
};

const tagColorsWriteQueues = new Map<string, Promise<unknown>>();

/** Serialize read-modify-write so rapid colour changes cannot drop other tag entries. */
const enqueueTagColorsWrite = <T>(rootPath: string, write: () => Promise<T>): Promise<T> => {
  const prior = tagColorsWriteQueues.get(rootPath) ?? Promise.resolve();
  const next = prior.then(write, write);
  tagColorsWriteQueues.set(rootPath, next);
  return next;
};

const applyTagColorUpdate = (
  file: TagColorsFile,
  tagName: string,
  colors: TagColorEntry | null,
): TagColorsFile => {
  const nextTags = { ...file.tags };
  const normalized = normalizeTagColorEntry(colors);
  if (!normalized) {
    delete nextTags[tagName];
  } else {
    nextTags[tagName] = normalized;
  }
  return { version: 1, tags: nextTags };
};

const persistTagColors = async (rootPath: string, file: TagColorsFile): Promise<TagColorsFile> => {
  await saveTagColors(rootPath, file);
  const css = generateTagColorsCss(file);
  cacheAndInjectTagColors(rootPath, css);
  await saveGeneratedTagColorsCss(rootPath, css);
  return file;
};

export const loadAndInjectTagColors = async (rootPath: string): Promise<TagColorsFile> => {
  const file = await loadTagColors(rootPath);
  const css = generateTagColorsCss(file);
  cacheAndInjectTagColors(rootPath, css);
  return file;
};

export const updateTagColor = async (
  rootPath: string,
  tagName: string,
  colors: TagColorEntry | null,
): Promise<TagColorsFile> =>
  enqueueTagColorsWrite(rootPath, async () => {
    const file = await loadTagColors(rootPath);
    return persistTagColors(rootPath, applyTagColorUpdate(file, tagName, colors));
  });
