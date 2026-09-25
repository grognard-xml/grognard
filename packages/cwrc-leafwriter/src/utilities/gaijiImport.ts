/**
 * Shared plumbing for bringing *inline* gaiji images in from outside -
 * pasting a Word selection whose text has picture-characters mixed into it,
 * or importing a .docx that does. Both paths reduce the rich source to
 * plain text with a private-use marker at each image's position (so the
 * existing text paste/import pipelines run unchanged), then swap each
 * marker for a real glyph afterwards.
 *
 * Kept free of Writer/TinyMCE so apps/commons' document import can use it
 * too (see the `@cwrc/leafwriter/gaijiImport` alias).
 */

import { assetDirForDocument, joinPath, relativeAssetUrl } from './assetPaths';
import {
  ensureGlyphCharDeclEntry,
  findGlyphCharDeclEntry,
  type GlyphGraphicSpec,
} from './glyphCharDecl';

/** U+E000/U+E001 bracket the image index. Private-use code points survive
 * every text transform on the way in (HTML escaping, paragraph splitting,
 * CJK whitespace stripping) and can't plausibly occur in real source text. */
const MARKER_OPEN = '';
const MARKER_CLOSE = '';

export const GAIJI_MARKER_PATTERN = /(\d+)/g;

/** 〓 (geta mark) - the traditional typesetter's stand-in for a character
 * the font doesn't have. Used where an image couldn't be converted, so the
 * position stays visible instead of the character silently vanishing. */
export const GAIJI_PLACEHOLDER = '〓';

export const gaijiMarker = (index: number): string => `${MARKER_OPEN}${index}${MARKER_CLOSE}`;

export const hasGaijiMarkers = (text: string): boolean =>
  new RegExp(GAIJI_MARKER_PATTERN).test(text);

export const stripGaijiMarkers = (text: string): string => text.replace(GAIJI_MARKER_PATTERN, '');

export const replaceGaijiMarkers = (text: string, replacer: (index: number) => string): string =>
  text.replace(GAIJI_MARKER_PATTERN, (_match, index: string) => replacer(Number(index)));

const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

const SKIPPED_ELEMENTS = new Set([
  'head',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title',
]);

/** Wide/fullwidth scripts where a source line break carries no space. */
const EAST_ASIAN_WIDE =
  /[ᄀ-ᇿ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦-]|[\ud840-\ud87f][\udc00-\udfff]/;

const isWideAt = (text: string, index: number, direction: -1 | 1): boolean => {
  if (index < 0 || index >= text.length) return false;
  // Step over a surrogate pair so astral CJK (Ext. B+) counts as wide too.
  const code = text.charCodeAt(index);
  if (direction === -1 && code >= 0xdc00 && code <= 0xdfff && index > 0) {
    return EAST_ASIAN_WIDE.test(text.slice(index - 1, index + 1));
  }
  if (direction === 1 && code >= 0xd800 && code <= 0xdbff) {
    return EAST_ASIAN_WIDE.test(text.slice(index, index + 2));
  }
  return EAST_ASIAN_WIDE.test(text[index]);
};

/** HTML whitespace collapsing, plus CSS Text's segment-break rule: Word
 * hard-wraps its clipboard HTML at arbitrary points, including between two
 * CJK characters, and such a break must vanish rather than become a space. */
const collapseWhitespace = (text: string): string =>
  text.replace(/[ \t\r\n\f]+/g, (run, offset: number, whole: string) => {
    const hasBreak = /[\r\n]/.test(run);
    if (hasBreak && isWideAt(whole, offset - 1, -1) && isWideAt(whole, offset + run.length, 1)) {
      return '';
    }
    return ' ';
  });

export interface GaijiMarkedText {
  /** Paragraphs separated by `\n` (an empty source paragraph gives an empty
   * line), with `gaijiMarker(i)` wherever `sources[i]` was. */
  text: string;
  /** Each `<img>`'s `src`, in document order. */
  sources: string[];
}

/**
 * Plain text for pasted rich HTML, keeping each image's position as a
 * marker. Line structure deliberately mirrors what Word itself puts on the
 * clipboard as `text/plain` (one line per paragraph), so the Paste Special
 * dialog sees the same shape it would have without the images.
 *
 * Word's VML duplicates (`<!--[if gte vml 1]><v:imagedata>`) sit inside
 * comments and are skipped automatically; the `<![if !vml]><img>` fallback
 * is a bogus comment to the HTML parser, so its `<img>` is the one we see.
 */
export const htmlToTextWithGaijiMarkers = (html: string): GaijiMarkedText => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sources: string[] = [];
  const lines: string[] = [];
  let current = '';

  const flush = (keepEmpty: boolean) => {
    const line = collapseWhitespace(current)
      .replace(/\u00a0/g, ' ')
      .trim();
    if (line || keepEmpty) lines.push(line);
    current = '';
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const name = element.localName.toLowerCase();
    if (SKIPPED_ELEMENTS.has(name)) return;

    if (name === 'img') {
      const src = element.getAttribute('src');
      if (!src) return;
      current += gaijiMarker(sources.length);
      sources.push(src);
      return;
    }

    if (name === 'br') {
      flush(true);
      return;
    }

    const isBlock = BLOCK_ELEMENTS.has(name);
    if (isBlock && current.trim()) flush(false);

    const hasBlockChild = Array.from(element.children).some((child) =>
      BLOCK_ELEMENTS.has(child.localName.toLowerCase()),
    );
    const linesBefore = lines.length;
    for (const child of Array.from(element.childNodes)) walk(child);

    // A leaf block that produced nothing at all is a real empty paragraph
    // (Word's `<p><o:p>&nbsp;</o:p></p>`); keep it so blank-line paragraph
    // breaks survive. One that already emitted lines (via <br>) isn't.
    if (isBlock) flush(!hasBlockChild && lines.length === linesBefore);
  };

  walk(doc.body);
  flush(false);

  while (lines.length > 0 && !lines[0]) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();

  return { text: lines.join('\n'), sources };
};

/** Cheap pre-check before doing any real work on a paste. */
export const htmlHasImages = (html: string): boolean => /<img\b[^>]*\bsrc\s*=/i.test(html);

export type SniffedImageType = 'bmp' | 'emf' | 'gif' | 'jpeg' | 'png' | 'tiff' | 'webp' | 'wmf';

export const sniffImageType = (bytes: Uint8Array): SniffedImageType | null => {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (at(0, 0x42, 0x4d)) return 'bmp';
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'tiff';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (at(0, 0x01, 0x00, 0x00, 0x00) && at(40, 0x20, 0x45, 0x4d, 0x46)) return 'emf';
  if (at(0, 0xd7, 0xcd, 0xc6, 0x9a) || at(0, 0x01, 0x00, 0x09, 0x00)) return 'wmf';
  return null;
};

/** Pixel size read from the file header, for the formats the vectorizer takes. */
export const imageDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = sniffImageType(bytes);
  try {
    if (type === 'png') return { width: view.getUint32(16), height: view.getUint32(20) };
    if (type === 'gif') return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (type === 'bmp') {
      return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    }
    if (type === 'jpeg') {
      // Walk the segments to the first start-of-frame marker.
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1];
        const length = view.getUint16(offset + 2);
        const isStartOfFrame =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isStartOfFrame) {
          return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // Truncated header.
  }
  return null;
};

/**
 * The copy of the same pasted image with more pixels to trace. Word's
 * clipboard HTML only has a screen-sized rendition of each inline image
 * (a gaiji at text size can be ~13 px wide), its RTF flavor a ~3x larger
 * one - but an original that happens to be web-friendly can come through
 * the HTML untouched and be the larger of the two, so compare, not assume.
 * Unreadable candidates lose.
 */
export const sharperImage = (
  first: Uint8Array | null,
  second: Uint8Array | null,
): Uint8Array | null => {
  const area = (bytes: Uint8Array | null) => {
    if (!bytes || !isVectorizableImage(bytes)) return 0;
    const size = imageDimensions(bytes);
    return size ? size.width * size.height : 0;
  };
  const firstArea = area(first);
  const secondArea = area(second);
  if (firstArea === 0 && secondArea === 0) return first ?? second;
  return secondArea > firstArea ? second : first;
};

/** What apps/desktop/src/glyphVectorize.ts (jimp 0.14) can actually decode. */
export const isVectorizableImage = (bytes: Uint8Array): boolean => {
  const type = sniffImageType(bytes);
  return type === 'png' || type === 'jpeg' || type === 'gif' || type === 'bmp' || type === 'tiff';
};

export const dataUrlToBytes = (url: string): Uint8Array | null => {
  const match = /^data:[^,]*?(;base64)?,(.*)$/is.exec(url);
  if (!match) return null;
  try {
    if (!match[1]) return new TextEncoder().encode(decodeURIComponent(match[2]));
    const binary = atob(match[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

/**
 * Glyph ids derived from the image bytes, so the same picture-character
 * pasted or imported many times becomes one `<glyph>` referenced many
 * times - like a font - rather than one declaration per occurrence. Also
 * immune to the same-millisecond collisions a clock-based id would hit
 * when a whole batch is converted at once.
 */
export const glyphIdForImageBytes = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `glyph-${hex}`;
};

export type GaijiConversionChoice = 'convert' | 'skip' | 'cancel';

/** Enter converts, Backspace keeps the text only, Escape cancels. */
export const gaijiChoiceForKey = (key: string): GaijiConversionChoice | null => {
  if (key === 'Enter') return 'convert';
  if (key === 'Backspace') return 'skip';
  if (key === 'Escape') return 'cancel';
  return null;
};

/** Where glyph assets live, next to the document - shared with glyphEditor.ts. */
export const GLYPH_ASSET_DIR = '_glyphs';

/** The slice of window.electronAPI that turning bytes into a glyph needs. */
export interface GlyphAssetApi {
  ensureDirectory?: (dirPath: string) => Promise<void>;
  vectorizeGlyphImage?: (
    bytes: Uint8Array,
  ) => Promise<{ svg: string; threshold: number; width: number; height: number }>;
  writeBinaryFile?: (filePath: string, bytes: Uint8Array) => Promise<void>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
}

const SOURCE_EXTENSION: Partial<Record<SniffedImageType, string>> = {
  bmp: 'bmp',
  gif: 'gif',
  jpeg: 'jpg',
  png: 'png',
  tiff: 'tif',
};

/**
 * Vectorizes `bytes` and writes the source image + SVG under `_glyphs/`
 * next to `documentPath`, returning the spec for a `<charDecl>` entry - or
 * the existing entry's spec when `xml` already declares this image's glyph
 * (same bytes, same id), in which case nothing is re-traced or rewritten.
 * Null when the image can't be converted (unsupported format such as
 * EMF/WMF, or the desktop APIs are missing).
 */
export const createGlyphAssetsFromBytes = async ({
  api,
  bytes,
  documentPath,
  xml,
}: {
  api: GlyphAssetApi | undefined;
  bytes: Uint8Array;
  documentPath: string;
  xml?: string | null;
}): Promise<GlyphGraphicSpec | null> => {
  const glyphId = await glyphIdForImageBytes(bytes);
  const existing = xml ? findGlyphCharDeclEntry(xml, glyphId) : null;
  if (existing) {
    return {
      glyphId,
      sourceUrl: existing.sourceUrl,
      svgUrl: existing.svgUrl,
      svgWidth: existing.width,
      svgHeight: existing.height,
    };
  }

  const extension = SOURCE_EXTENSION[sniffImageType(bytes) ?? 'wmf'];
  if (!extension) return null;
  if (!api?.vectorizeGlyphImage || !api.writeBinaryFile || !api.writeFile || !api.ensureDirectory) {
    return null;
  }

  const { svg, width, height } = await api.vectorizeGlyphImage(bytes);
  const dir = assetDirForDocument(documentPath, GLYPH_ASSET_DIR);
  await api.ensureDirectory(dir);
  const sourceFileName = `${glyphId}.${extension}`;
  const svgFileName = `${glyphId}.svg`;
  await api.writeBinaryFile(joinPath(dir, sourceFileName), bytes);
  await api.writeFile(joinPath(dir, svgFileName), svg);

  return {
    glyphId,
    sourceUrl: relativeAssetUrl(GLYPH_ASSET_DIR, sourceFileName),
    svgUrl: relativeAssetUrl(GLYPH_ASSET_DIR, svgFileName),
    svgWidth: width,
    svgHeight: height,
  };
};

const escapeXmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Swaps the markers left in a freshly built import document for glyphs.
 * `specs[i]` is marker i's glyph, or null to leave a 〓 placeholder.
 *
 * `mode: 'charDecl'` writes `<g ref="#id">` plus one `<charDecl><glyph>`
 * per distinct image (what the editor itself inserts on every schema that
 * has `<g>`); `mode: 'graphic'` is TEI Lite's inline `<graphic>` fallback.
 * Falls back to `graphic` if the header can't take a `<charDecl>`.
 */
export const applyGaijiGlyphsToXml = (
  xml: string,
  specs: (GlyphGraphicSpec | null)[],
  mode: 'charDecl' | 'graphic',
): string => {
  const graphicFor = (spec: GlyphGraphicSpec) =>
    `<graphic type="glyph" url="${escapeXmlAttribute(spec.svgUrl)}" mimeType="image/svg+xml" ` +
    `width="${spec.svgWidth}" height="${spec.svgHeight}"/>`;

  if (mode === 'charDecl') {
    let declared: string | null = xml;
    const seen = new Set<string>();
    for (const spec of specs) {
      if (!spec || seen.has(spec.glyphId) || declared === null) continue;
      seen.add(spec.glyphId);
      declared = ensureGlyphCharDeclEntry(declared, spec);
    }
    if (declared !== null) {
      // XMLSerializer drops the XML declaration - put the original back.
      const declaration = /^\s*<\?xml\s[^?]*\?>/.exec(xml)?.[0];
      if (declaration && !declared.trimStart().startsWith('<?xml')) {
        declared = `${declaration.trim()}\n${declared}`;
      }
      return replaceGaijiMarkers(declared, (index) => {
        const spec = specs[index];
        if (!spec) return GAIJI_PLACEHOLDER;
        const id = escapeXmlAttribute(spec.glyphId);
        return `<g type="glyph" n="${id}" ref="#${id}"/>`;
      });
    }
  }

  return replaceGaijiMarkers(xml, (index) => {
    const spec = specs[index];
    return spec ? graphicFor(spec) : GAIJI_PLACEHOLDER;
  });
};
