import fs from 'fs/promises';
import mammoth from 'mammoth';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Inline images arriving with pasted/imported text - see
 * packages/cwrc-leafwriter/src/utilities/gaijiImport.ts for the renderer
 * side, which turns them into glyphs.
 */

const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|webp)$/i;

/**
 * Word doesn't embed images in its clipboard HTML: it writes each one to a
 * temp `msohtmlclip` folder and points `<img src="file:///...">` at it. The
 * renderer can't read arbitrary paths (see assertRendererReadPath), so this
 * is a deliberately narrow exception: an image file that is either inside a
 * `msohtmlclip*` folder (Word's, wherever the OS puts it - on macOS that's
 * the Office group container, not the temp dir) or inside the system temp
 * dir. Returns null for anything else.
 */
export const resolvePastedImagePath = (fileUrl: string, tempDir = os.tmpdir()): string | null => {
  let candidate: string;
  try {
    const parsed = new URL(fileUrl);
    if (parsed.protocol !== 'file:') return null;
    // Word on macOS emits `file:////Users/...` - normalize the doubled slash away.
    candidate = path.resolve(path.normalize(fileURLToPath(parsed)));
  } catch {
    return null;
  }

  if (!IMAGE_EXTENSION.test(candidate)) return null;

  const segments = candidate.split(/[\\/]+/);
  const inWordClipFolder = segments.some((segment) => /^msohtmlclip/i.test(segment));
  const relativeToTemp = path.relative(path.resolve(tempDir), candidate);
  const inTempDir =
    relativeToTemp !== '' && !relativeToTemp.startsWith('..') && !path.isAbsolute(relativeToTemp);

  return inWordClipFolder || inTempDir ? candidate : null;
};

export const readPastedImageFile = async (fileUrl: string): Promise<Uint8Array | null> => {
  const filePath = resolvePastedImagePath(fileUrl);
  if (!filePath) return null;
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.size > MAX_PASTED_IMAGE_BYTES) return null;
    return new Uint8Array(await fs.readFile(filePath));
  } catch {
    return null;
  }
};

/** Mirrors gaijiMarker() in packages/cwrc-leafwriter/src/utilities/gaijiImport.ts. */
const gaijiMarker = (index: number): string => `${index}`;

interface MammothElement {
  type: string;
  value?: string;
  children?: MammothElement[];
  contentType?: string;
  read?: () => Promise<Buffer>;
}

export interface DocxTextWithImages {
  /** Same text as mammoth.extractRawText, plus a marker at each inline image. */
  text: string;
  images: { contentType: string; bytes: Uint8Array }[];
  warnings: string[];
}

/**
 * mammoth.extractRawText has no hook for images, but convertToHtml exposes
 * the parsed document tree via transformDocument - walk that ourselves,
 * reproducing raw-text's rules exactly (paragraph -> "\n\n", tab -> "\t")
 * so documents without images import identically, and emit a marker for
 * each image. The HTML mammoth then renders is discarded.
 */
export const extractDocxTextWithImages = async (filePath: string): Promise<DocxTextWithImages> => {
  const imageElements: MammothElement[] = [];
  let text = '';

  const toText = (element: MammothElement): string => {
    if (element.type === 'text') return element.value ?? '';
    if (element.type === 'tab') return '\t';
    if (element.type === 'image') {
      const marker = gaijiMarker(imageElements.length);
      imageElements.push(element);
      return marker;
    }
    const tail = element.type === 'paragraph' ? '\n\n' : '';
    return (element.children ?? []).map(toText).join('') + tail;
  };

  const result = await mammoth.convertToHtml(
    { path: filePath },
    {
      transformDocument: (document: MammothElement) => {
        text = toText(document);
        return document;
      },
      // Skip mammoth's own base64 encoding of every image for HTML we throw away.
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    },
  );

  const images = await Promise.all(
    imageElements.map(async (element) => ({
      contentType: element.contentType ?? '',
      bytes: element.read ? new Uint8Array(await element.read()) : new Uint8Array(),
    })),
  );

  return {
    text,
    images,
    warnings: result.messages.map((message) => message.message),
  };
};
