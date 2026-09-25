import Jimp from 'jimp';
import {
  bitmapFromEmf,
  bitmapFromWmf,
  decodeDib,
  extractRtfImages,
  parseRtfPictures,
} from './rtfImages';

const WIDTH = 6;
const HEIGHT = 4;

/** 32-bit bottom-up BI_RGB DIB: white, with a black pixel at top-left (0,0). */
const buildDib = (): Uint8Array => {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(WIDTH, 4);
  header.writeInt32LE(HEIGHT, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const bits = Buffer.alloc(WIDTH * HEIGHT * 4, 0xff);
  for (let p = 3; p < bits.length; p += 4) bits[p] = 0; // alpha unused, as in real EMFs
  const topRowStart = (HEIGHT - 1) * WIDTH * 4; // bottom-up: last row is the top
  bits.fill(0, topRowStart, topRowStart + 4);
  return new Uint8Array(Buffer.concat([header, bits]));
};

const buildEmf = (dib: Uint8Array): Uint8Array => {
  const header = Buffer.alloc(108);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(108, 4);
  header.write(' EMF', 40, 'latin1');

  const recordHeader = Buffer.alloc(80);
  const size = 80 + dib.length;
  recordHeader.writeUInt32LE(0x51, 0); // EMR_STRETCHDIBITS
  recordHeader.writeUInt32LE(size, 4);
  recordHeader.writeUInt32LE(80, 48); // offBmiSrc
  recordHeader.writeUInt32LE(40, 52); // cbBmiSrc
  recordHeader.writeUInt32LE(120, 56); // offBitsSrc
  recordHeader.writeUInt32LE(dib.length - 40, 60); // cbBitsSrc

  const eof = Buffer.alloc(20);
  eof.writeUInt32LE(14, 0);
  eof.writeUInt32LE(20, 4);
  return new Uint8Array(Buffer.concat([header, recordHeader, Buffer.from(dib), eof]));
};

const buildWmf = (dib: Uint8Array): Uint8Array => {
  const header = Buffer.alloc(18);
  header.writeUInt16LE(1, 0);
  header.writeUInt16LE(9, 2); // header size in words
  const record = Buffer.alloc(28);
  record.writeUInt32LE((28 + dib.length) / 2, 0);
  record.writeUInt16LE(0x0f43, 4); // META_STRETCHDIB
  const eof = Buffer.alloc(6);
  eof.writeUInt32LE(3, 0);
  return new Uint8Array(Buffer.concat([header, record, Buffer.from(dib), eof]));
};

const toHex = (bytes: Uint8Array, lineLength = 64) =>
  Buffer.from(bytes)
    .toString('hex')
    .replace(new RegExp(`(.{${lineLength}})`, 'g'), '$1\r\n');

const expectTopLeftBlack = (bitmap: ReturnType<typeof decodeDib>) => {
  expect(bitmap).not.toBeNull();
  expect([bitmap!.width, bitmap!.height]).toEqual([WIDTH, HEIGHT]);
  expect([...bitmap!.rgba.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  expect([...bitmap!.rgba.subarray(4, 8)]).toEqual([255, 255, 255, 255]);
};

describe('bitmap decoding', () => {
  it('decodes a bottom-up 32-bit DIB, treating all-zero alpha as opaque', () => {
    expectTopLeftBlack(decodeDib(buildDib(), 0));
  });

  it('finds the bitmap inside an EMF StretchDIBits record', () => {
    expectTopLeftBlack(bitmapFromEmf(buildEmf(buildDib())));
  });

  it('finds the bitmap inside a WMF StretchDIB record', () => {
    expectTopLeftBlack(bitmapFromWmf(buildWmf(buildDib())));
  });

  it('decodes a 1-bit paletted DIB', () => {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(8, 4);
    header.writeInt32LE(-1, 8); // top-down, one row
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(1, 14);
    const palette = Buffer.from([0, 0, 0, 0, 255, 255, 255, 0]);
    const bits = Buffer.from([0b01111111, 0, 0, 0]); // first pixel palette[0] (black)
    const bitmap = decodeDib(new Uint8Array(Buffer.concat([header, palette, bits])), 0);
    expect(bitmap?.width).toBe(8);
    expect([...bitmap!.rgba.subarray(0, 8)]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

describe('extractRtfImages', () => {
  const emf = buildEmf(buildDib());
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const rtf =
    '{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}\\pard 天' +
    // Word's pairing: the real picture, then a legacy duplicate to skip.
    `{\\*\\shppict{\\pict{\\*\\picprop{\\sp{\\sn x}{\\sv 1}}}\\picwgoal400\\pichgoal440\\emfblip{\\*\\blipuid 0123456789abcdef}\r\n${toHex(emf)}}}` +
    `{\\nonshppict{\\pict\\picwgoal400\\pichgoal440\\wmetafile8 ${toHex(emf)}}}` +
    ' 地' +
    `{\\pict\\pngblip ${toHex(png)}}` +
    " \\'e4\\'ba\\'ba}";

  it('keeps one picture per image, in order, skipping nonshppict duplicates', () => {
    const pictures = parseRtfPictures(rtf);
    expect(pictures.map((picture) => [picture.inShppict, picture.inNonShppict])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(Buffer.from(pictures[0].data).equals(Buffer.from(emf))).toBe(true);
  });

  it('returns vectorizer-readable bytes for each picture', async () => {
    const images = await extractRtfImages(rtf);
    expect(images).toHaveLength(2);

    const fromEmf = await Jimp.read(Buffer.from(images[0]!));
    expect([fromEmf.bitmap.width, fromEmf.bitmap.height]).toEqual([WIDTH, HEIGHT]);
    expect(fromEmf.getPixelColor(0, 0)).toBe(0x000000ff);
    expect(fromEmf.getPixelColor(1, 0)).toBe(0xffffffff);

    expect(Buffer.from(images[1]!).equals(png)).toBe(true);
  });

  it('decodes EMF data that Word mislabels as \\wmetafile8', async () => {
    const images = await extractRtfImages(`{\\rtf1{\\pict\\wmetafile8 ${toHex(emf)}}}`);
    expect(images[0]).not.toBeNull();
  });

  it('returns null for undecodable pictures so indexes stay aligned', async () => {
    const images = await extractRtfImages(
      `{\\rtf1{\\pict\\macpict 0011}{\\pict\\pngblip ${toHex(png)}}}`,
    );
    expect(images[0]).toBeNull();
    expect(images[1]).not.toBeNull();
  });
});
