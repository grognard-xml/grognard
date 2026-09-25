import { webcrypto } from 'crypto';

import {
  dataUrlToBytes,
  gaijiChoiceForKey,
  gaijiMarker,
  glyphIdForImageBytes,
  hasGaijiMarkers,
  imageDimensions,
  htmlHasImages,
  htmlToTextWithGaijiMarkers,
  isVectorizableImage,
  replaceGaijiMarkers,
  sharperImage,
  sniffImageType,
  stripGaijiMarkers,
} from './gaijiImport';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('htmlToTextWithGaijiMarkers', () => {
  it('replaces inline images with ordered markers', () => {
    const result = htmlToTextWithGaijiMarkers(
      '<p>天<img src="file:///a.png">地<img src="data:image/png;base64,AA==">人</p>',
    );
    expect(result.sources).toEqual(['file:///a.png', 'data:image/png;base64,AA==']);
    expect(result.text).toBe(`天${gaijiMarker(0)}地${gaijiMarker(1)}人`);
  });

  it('gives one line per Word paragraph, keeping empty ones', () => {
    const html = `<html><head><style>p{}</style></head><body>
      <!--StartFragment-->
      <p class=MsoNormal>first</p>
      <p class=MsoNormal><o:p>&nbsp;</o:p></p>
      <p class=MsoNormal>second</p>
      <!--EndFragment--></body></html>`;
    expect(htmlToTextWithGaijiMarkers(html).text).toBe('first\n\nsecond');
  });

  it('ignores Word VML duplicates inside conditional comments', () => {
    const html =
      '<p>a<!--[if gte vml 1]><v:shape><v:imagedata src="file:///vml.png"/></v:shape><![endif]-->' +
      '<![if !vml]><img src="file:///real.png"><![endif]>b</p>';
    const result = htmlToTextWithGaijiMarkers(html);
    expect(result.sources).toEqual(['file:///real.png']);
    expect(result.text).toBe(`a${gaijiMarker(0)}b`);
  });

  it('drops source line wraps between CJK characters but keeps them as spaces in Latin text', () => {
    expect(htmlToTextWithGaijiMarkers('<p>天地\n玄黃</p>').text).toBe('天地玄黃');
    expect(htmlToTextWithGaijiMarkers('<p>heaven\nearth</p>').text).toBe('heaven earth');
    expect(htmlToTextWithGaijiMarkers('<p>天\n<img src="x.png">\n地</p>').text).toBe(
      `天${gaijiMarker(0)}地`,
    );
  });

  it('treats <br> as a line break without an extra blank line', () => {
    expect(htmlToTextWithGaijiMarkers('<p>one<br>two</p><p>three</p>').text).toBe(
      'one\ntwo\nthree',
    );
  });
});

describe('marker helpers', () => {
  it('detects, strips and replaces markers', () => {
    const text = `a${gaijiMarker(0)}b${gaijiMarker(12)}c`;
    expect(hasGaijiMarkers(text)).toBe(true);
    expect(hasGaijiMarkers('abc')).toBe(false);
    expect(stripGaijiMarkers(text)).toBe('abc');
    expect(replaceGaijiMarkers(text, (index) => `[${index}]`)).toBe('a[0]b[12]c');
  });

  it('pre-checks HTML for images', () => {
    expect(htmlHasImages('<p>x<img class=a src="y"></p>')).toBe(true);
    expect(htmlHasImages('<p>image</p>')).toBe(false);
  });
});

describe('image sniffing', () => {
  it('recognizes formats the vectorizer can and cannot read', () => {
    expect(sniffImageType(PNG)).toBe('png');
    expect(isVectorizableImage(PNG)).toBe(true);

    const emf = new Uint8Array(44);
    emf.set([0x01, 0x00, 0x00, 0x00]);
    emf.set([0x20, 0x45, 0x4d, 0x46], 40);
    expect(sniffImageType(emf)).toBe('emf');
    expect(isVectorizableImage(emf)).toBe(false);
  });

  it('decodes data URLs', () => {
    expect(dataUrlToBytes('data:image/png;base64,iVBORw0KGgo=')).toEqual(PNG);
    expect(dataUrlToBytes('file:///x.png')).toBeNull();
  });
});

describe('glyphIdForImageBytes', () => {
  const originalCrypto = globalThis.crypto;
  beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    }
  });
  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
  });

  it('is stable for identical bytes and differs otherwise', async () => {
    const a = await glyphIdForImageBytes(PNG);
    expect(a).toMatch(/^glyph-[0-9a-f]{16}$/);
    expect(await glyphIdForImageBytes(PNG.slice())).toBe(a);
    expect(await glyphIdForImageBytes(new Uint8Array([1, 2, 3]))).not.toBe(a);
  });
});

describe('gaijiChoiceForKey', () => {
  it('maps Enter / Backspace / Escape', () => {
    expect(gaijiChoiceForKey('Enter')).toBe('convert');
    expect(gaijiChoiceForKey('Backspace')).toBe('skip');
    expect(gaijiChoiceForKey('Escape')).toBe('cancel');
    expect(gaijiChoiceForKey('a')).toBeNull();
  });
});

const pngOfSize = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

describe('imageDimensions / sharperImage', () => {
  it('reads PNG, GIF and JPEG sizes from their headers', () => {
    expect(imageDimensions(pngOfSize(13, 25))).toEqual({ width: 13, height: 25 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 106, 0, 119, 0]);
    expect(imageDimensions(gif)).toEqual({ width: 106, height: 119 });
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 48, 0, 42, 1, 0, 0,
    ]);
    expect(imageDimensions(jpeg)).toEqual({ width: 42, height: 48 });
  });

  it("prefers Word's larger RTF rendition, but keeps a larger HTML original", () => {
    const tinyHtml = pngOfSize(13, 25);
    const rtf = pngOfSize(42, 48);
    expect(sharperImage(tinyHtml, rtf)).toBe(rtf);

    const originalGif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 106, 0, 119, 0]);
    expect(sharperImage(originalGif, rtf)).toBe(originalGif);
  });

  it('falls back to whichever copy exists', () => {
    const rtf = pngOfSize(42, 48);
    expect(sharperImage(null, rtf)).toBe(rtf);
    expect(sharperImage(rtf, null)).toBe(rtf);
    expect(sharperImage(null, null)).toBeNull();
  });
});
