import Jimp from 'jimp';

/**
 * Pulls the inline pictures out of RTF, in document order - used for Word
 * pastes, whose clipboard HTML only carries a screen-resolution rendition of
 * each image (often ~13 px wide for a gaiji at text size, too small to
 * trace), while the RTF flavor carries a markedly larger one: typically an
 * EMF wrapping a bitmap at ~3x screen resolution. Still not Word's original
 * (that never reaches the clipboard - only a .docx import gets it), but
 * legible where the HTML copy isn't.
 *
 * Each picture comes back as PNG/JPEG bytes the vectorizer can read, or null
 * where it couldn't be decoded, so indexes stay aligned with the HTML
 * `<img>`s for the caller's one-to-one matching.
 */

interface RtfPicture {
  /** Control words of the `{\pict ...}` group itself (not nested groups). */
  words: Map<string, number | null>;
  data: Uint8Array;
  inShppict: boolean;
  inNonShppict: boolean;
}

const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isDigit = (code: number) => code >= 48 && code <= 57;
const hexValue = (code: number): number => {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
};

/** Minimal RTF tokenizer: tracks each group's destination so a `\pict` can
 * tell whether it sits in a `\shppict` (the real picture) or a `\nonshppict`
 * (Word's legacy duplicate of the same picture). */
export const parseRtfPictures = (rtf: string): RtfPicture[] => {
  const pictures: RtfPicture[] = [];
  // Per open group: its destination word (first control word), if any yet.
  const stack: { destination: string | null }[] = [];
  let current: {
    picture: RtfPicture;
    depth: number;
    hex: number[];
    pendingNibble: number;
  } | null = null;
  let i = 0;

  const readControlWord = (): { word: string; param: number | null } => {
    const start = i;
    while (i < rtf.length && isLetter(rtf.charCodeAt(i))) i++;
    const word = rtf.slice(start, i);
    let param: number | null = null;
    const paramStart = i;
    if (rtf[i] === '-') i++;
    while (i < rtf.length && isDigit(rtf.charCodeAt(i))) i++;
    if (i > paramStart && rtf.slice(paramStart, i) !== '-')
      param = Number(rtf.slice(paramStart, i));
    else i = paramStart;
    if (rtf[i] === ' ') i++;
    return { word, param };
  };

  while (i < rtf.length) {
    const char = rtf[i];

    if (char === '{') {
      stack.push({ destination: null });
      i++;
      continue;
    }

    if (char === '}') {
      if (current && stack.length === current.depth) {
        const bytes = new Uint8Array(current.hex.length);
        bytes.set(current.hex);
        if (current.picture.data.length > 0) {
          const merged = new Uint8Array(current.picture.data.length + bytes.length);
          merged.set(current.picture.data);
          merged.set(bytes, current.picture.data.length);
          current.picture.data = merged;
        } else {
          current.picture.data = bytes;
        }
        pictures.push(current.picture);
        current = null;
      }
      stack.pop();
      i++;
      continue;
    }

    if (char === '\\') {
      i++;
      const next = rtf.charCodeAt(i);
      if (isLetter(next)) {
        const { word, param } = readControlWord();
        const group = stack[stack.length - 1];
        if (group && group.destination === null) group.destination = word;

        if (word === 'pict' && !current && group?.destination === 'pict') {
          const destinations = stack.map((entry) => entry.destination);
          current = {
            picture: {
              words: new Map(),
              data: new Uint8Array(),
              inShppict: destinations.includes('shppict'),
              inNonShppict: destinations.includes('nonshppict'),
            },
            depth: stack.length,
            hex: [],
            pendingNibble: -1,
          };
          continue;
        }

        if (current && stack.length === current.depth) {
          if (word === 'bin' && param !== null && param > 0) {
            // Raw binary run: `param` bytes follow verbatim.
            for (let k = 0; k < param && i < rtf.length; k++)
              current.hex.push(rtf.charCodeAt(i++) & 0xff);
            continue;
          }
          current.picture.words.set(word, param);
        }
        continue;
      }
      // Control symbol: \* marks an ignorable destination (keep looking for
      // the real word); \'hh is an escaped byte; anything else is one char.
      if (rtf[i] === "'") i += 3;
      else i++;
      continue;
    }

    if (current && stack.length === current.depth) {
      const value = hexValue(rtf.charCodeAt(i));
      if (value >= 0) {
        if (current.pendingNibble < 0) {
          current.pendingNibble = value;
        } else {
          current.hex.push((current.pendingNibble << 4) | value);
          current.pendingNibble = -1;
        }
      }
    }
    i++;
  }

  return pictures;
};

/** Word writes `{\*\shppict{\pict..}}{\nonshppict{\pict..}}` per picture:
 * the second is a legacy duplicate of the first. Drop exactly those. */
const selectDistinctPictures = (pictures: RtfPicture[]): RtfPicture[] => {
  const selected: RtfPicture[] = [];
  let previousWasShppict = false;
  for (const picture of pictures) {
    if (picture.inNonShppict && previousWasShppict) {
      previousWasShppict = false;
      continue;
    }
    selected.push(picture);
    previousWasShppict = picture.inShppict;
  }
  return selected;
};

interface DecodedBitmap {
  width: number;
  height: number;
  /** RGBA, top-down, already flattened onto white. */
  rgba: Buffer;
}

const u16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const u32 = (view: DataView, offset: number) => view.getUint32(offset, true);
const i32 = (view: DataView, offset: number) => view.getInt32(offset, true);

/**
 * Decodes a packed or split DIB (BITMAPINFO + pixel bits). Handles the
 * uncompressed 1/4/8/24/32-bit forms Office actually emits; RLE and
 * 16-bit are rare enough here to return null for.
 */
export const decodeDib = (
  bytes: Uint8Array,
  bmiOffset: number,
  bitsOffset?: number,
): DecodedBitmap | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bmiOffset + 40 > bytes.length) return null;
  const headerSize = u32(view, bmiOffset);
  if (headerSize < 40) return null;
  const width = i32(view, bmiOffset + 4);
  const rawHeight = i32(view, bmiOffset + 8);
  const bitCount = u16(view, bmiOffset + 14);
  const compression = u32(view, bmiOffset + 16);
  const colorsUsed = u32(view, bmiOffset + 32);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return null;
  if (![1, 4, 8, 24, 32].includes(bitCount)) return null;
  // BI_RGB, or BI_BITFIELDS with the standard 32-bit BGRA masks.
  if (compression !== 0 && !(compression === 3 && bitCount === 32)) return null;

  const paletteEntries = bitCount <= 8 ? colorsUsed || 1 << bitCount : 0;
  const masksSize = compression === 3 && headerSize === 40 ? 12 : 0;
  const paletteOffset = bmiOffset + headerSize + masksSize;
  const pixelOffset = bitsOffset ?? paletteOffset + paletteEntries * 4;
  const stride = Math.floor((width * bitCount + 31) / 32) * 4;
  if (pixelOffset + stride * height > bytes.length) return null;

  // 32-bit DIBs in metafiles often leave alpha all zero (meaning "opaque");
  // only honour alpha when some pixel actually uses it.
  let alphaMeaningful = false;
  if (bitCount === 32) {
    for (let p = pixelOffset + 3; p < pixelOffset + stride * height; p += 4) {
      if (bytes[p] !== 0) {
        alphaMeaningful = true;
        break;
      }
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = pixelOffset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (bitCount >= 24) {
        const p = row + x * (bitCount / 8);
        b = bytes[p];
        g = bytes[p + 1];
        r = bytes[p + 2];
        if (alphaMeaningful) a = bytes[p + 3];
      } else {
        const bitIndex = x * bitCount;
        const byte = bytes[row + (bitIndex >> 3)];
        const shift = 8 - bitCount - (bitIndex & 7);
        const index = (byte >> shift) & ((1 << bitCount) - 1);
        const entry = paletteOffset + Math.min(index, paletteEntries - 1) * 4;
        b = bytes[entry];
        g = bytes[entry + 1];
        r = bytes[entry + 2];
      }
      // Flatten onto white paper, as the vectorizer would anyway.
      const out = (y * width + x) * 4;
      rgba[out] = Math.round((r * a + 255 * (255 - a)) / 255);
      rgba[out + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
      rgba[out + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
      rgba[out + 3] = 255;
    }
  }
  return { width, height, rgba };
};

const largest = (bitmaps: (DecodedBitmap | null)[]): DecodedBitmap | null =>
  bitmaps.reduce<DecodedBitmap | null>(
    (best, bitmap) =>
      bitmap && (!best || bitmap.width * bitmap.height > best.width * best.height) ? bitmap : best,
    null,
  );

/** EMF: the largest bitmap drawn by any of the DIB-carrying records. */
export const bitmapFromEmf = (bytes: Uint8Array): DecodedBitmap | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: (DecodedBitmap | null)[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const type = u32(view, offset);
    const size = u32(view, offset + 4);
    if (size < 8 || offset + size > bytes.length) break;
    // Offsets of offBmiSrc/cbBmiSrc/offBitsSrc/cbBitsSrc within each record.
    const fieldsAt =
      type === 0x50 || type === 0x51 // SETDIBITSTODEVICE, STRETCHDIBITS
        ? 48
        : type === 0x4c || type === 0x4d || type === 0x72 // BITBLT, STRETCHBLT, ALPHABLEND
          ? 84
          : -1;
    if (fieldsAt > 0 && size >= fieldsAt + 16) {
      const offBmi = u32(view, offset + fieldsAt);
      const cbBmi = u32(view, offset + fieldsAt + 4);
      const offBits = u32(view, offset + fieldsAt + 8);
      const cbBits = u32(view, offset + fieldsAt + 12);
      if (cbBmi > 0 && cbBits > 0 && offBmi + cbBmi <= size && offBits + cbBits <= size) {
        found.push(decodeDib(bytes, offset + offBmi, offset + offBits));
      }
    }
    if (type === 14) break; // EMR_EOF
    offset += size;
  }
  return largest(found);
};

/** WMF: the largest bitmap in any DIB-carrying record. */
export const bitmapFromWmf = (bytes: Uint8Array): DecodedBitmap | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = bytes.length >= 22 && u32(view, 0) === 0x9ac6cdd7 ? 22 : 0; // placeable header
  if (offset + 18 > bytes.length) return null;
  offset += u16(view, offset + 2) * 2; // standard header, sized in words
  const found: (DecodedBitmap | null)[] = [];
  while (offset + 6 <= bytes.length) {
    const size = u32(view, offset) * 2;
    const fn = u16(view, offset + 4);
    if (size < 6 || fn === 0 || offset + size > bytes.length) break;
    // Where the DIB starts within each record type (params are 16-bit words
    // after the 6-byte record header; RasterOperation is 32-bit).
    const dibAt =
      fn === 0x0f43 // META_STRETCHDIB
        ? 28
        : fn === 0x0b41 // META_DIBSTRETCHBLT
          ? 26
          : fn === 0x0940 // META_DIBBITBLT
            ? 22
            : fn === 0x0d33 // META_SETDIBTODEV
              ? 24
              : -1;
    if (dibAt > 0 && size > dibAt + 40) {
      found.push(decodeDib(bytes.subarray(offset, offset + size), dibAt));
    }
    offset += size;
  }
  return largest(found);
};

const encodePng = async (bitmap: DecodedBitmap): Promise<Uint8Array> => {
  const image = new Jimp(bitmap.width, bitmap.height);
  bitmap.rgba.copy(image.bitmap.data);
  return new Uint8Array(await image.getBufferAsync(Jimp.MIME_PNG));
};

const pictureToImage = async (picture: RtfPicture): Promise<Uint8Array | null> => {
  const { words, data } = picture;
  if (data.length === 0) return null;

  // Trust the bytes over the control word: Word for Mac labels its legacy
  // `\nonshppict` copy `\wmetafile8` while actually writing EMF data into it.
  const at = (offset: number, ...values: number[]) =>
    values.every((value, index) => data[offset + index] === value);
  const isPng = at(0, 0x89, 0x50, 0x4e, 0x47);
  const isJpeg = at(0, 0xff, 0xd8, 0xff);
  const isEmf = at(0, 0x01, 0x00, 0x00, 0x00) && at(40, 0x20, 0x45, 0x4d, 0x46);
  if (isPng || isJpeg) return data;

  const bitmap = isEmf
    ? bitmapFromEmf(data)
    : words.has('wmetafile')
      ? bitmapFromWmf(data)
      : words.has('dibitmap')
        ? decodeDib(data, 0)
        : null;
  return bitmap ? encodePng(bitmap) : null;
};

export const extractRtfImages = async (rtf: string): Promise<(Uint8Array | null)[]> => {
  const pictures = selectDistinctPictures(parseRtfPictures(rtf));
  return Promise.all(
    pictures.map((picture) =>
      pictureToImage(picture).catch((error) => {
        console.warn('[rtfImages] could not decode picture', error);
        return null;
      }),
    ),
  );
};
