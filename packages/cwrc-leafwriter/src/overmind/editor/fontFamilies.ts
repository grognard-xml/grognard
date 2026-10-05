export interface FontFamilyOption {
  label: string;
  value: string;
}

export const SYSTEM_LATIN_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, Helvetica, sans-serif';

export const SYSTEM_ASIAN_FONT =
  '"Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Hiragino Sans", "Yu Gothic", "Microsoft YaHei", SimSun, sans-serif';

export const DEFAULT_LATIN_FONT = SYSTEM_LATIN_FONT;
export const DEFAULT_ASIAN_FONT = SYSTEM_ASIAN_FONT;

export const FALLBACK_LATIN_FONT_OPTIONS: FontFamilyOption[] = [
  { label: 'System Sans', value: SYSTEM_LATIN_FONT },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times/Georgia', value: 'Georgia, "Times New Roman", Times, serif' },
  { label: 'Noto Serif', value: '"Noto Serif", Georgia, "Times New Roman", serif' },
];

export const FALLBACK_ASIAN_FONT_OPTIONS: FontFamilyOption[] = [
  { label: 'System CJK', value: SYSTEM_ASIAN_FONT },
  {
    label: 'Noto Sans CJK',
    value: '"Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", sans-serif',
  },
  { label: 'Song/Ming Serif', value: 'SimSun, "Songti SC", PMingLiU, serif' },
  { label: 'Japanese Gothic', value: '"Hiragino Sans", "Yu Gothic", Meiryo, sans-serif' },
  { label: 'Korean Gothic', value: '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif' },
];

export const quoteFontFamily = (family: string) => JSON.stringify(family);

export const getFontFamilyLabel = (value: string) => {
  const fallbackOption = [...FALLBACK_LATIN_FONT_OPTIONS, ...FALLBACK_ASIAN_FONT_OPTIONS].find(
    (option) => option.value === value,
  );
  if (fallbackOption) return fallbackOption.label;

  const trimmed = value.trim();
  const singleFamilyMatch = trimmed.match(/^"((?:\\"|[^"])*)"$/);
  if (singleFamilyMatch) return singleFamilyMatch[1].replace(/\\"/g, '"');
  return trimmed;
};

export const getValidFontFamily = (value: string | null | undefined, fallback: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
};

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

/** Splits a font-family list on top-level commas (commas inside quotes are kept). */
const splitFontFamilies = (value: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
};

/**
 * The editor's body font stack: the Latin fonts first, then the Asian font. Dropping the Latin
 * list's trailing generic family (`sans-serif`) matters: a generic always resolves to some
 * installed font, so anything after it would never be reached and Han characters missing from the
 * Latin fonts would fall to the OS default instead of the Asian font. This is what makes the
 * Asian font apply to documents that carry no `lang` / `xml:lang`, such as Kanripo imports.
 */
export const combineFontFamilies = (latinFont: string, asianFont: string): string => {
  const latin = splitFontFamilies(latinFont).filter(
    (family) => !GENERIC_FAMILIES.has(family.toLowerCase()),
  );
  return [...latin, asianFont.trim()].filter(Boolean).join(', ');
};

/**
 * Rules for the editor iframe. Schema CSS is rewritten to `*[_tag="TEI"] { ... }` and lands on the
 * root element itself (a project `tei.css` commonly says `TEI { font-family: Georgia, serif }`),
 * which beats anything inherited from `body` and silently overrides the user's font settings.
 * `body > *[_tag]` is more specific than that attribute selector, so the settings win at the root
 * while the stylesheet can still style individual elements below it. `cjkSelectors` keeps the
 * Asian font on language-tagged content.
 */
export const buildEditorFontCss = (
  latinFont: string,
  asianFont: string,
  cjkSelectors: string,
): string => {
  const bodyFont = combineFontFamilies(latinFont, asianFont);
  return `
    body {
      font-family: ${bodyFont};
    }

    body > *[_tag] {
      font-family: ${bodyFont};
    }

    ${cjkSelectors} {
      font-family: ${asianFont};
    }
  `;
};
