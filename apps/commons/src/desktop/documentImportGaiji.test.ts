import { webcrypto } from 'crypto';

import { convertImportedGaiji, gaijiModeForCatalog } from './documentImportGaiji';

const TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>t</title></titleStmt></fileDesc></teiHeader>
<text><body><div type="text"><p>天0地1人2</p></div></body></text></TEI>`;

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const EMF = (() => {
  const bytes = new Uint8Array(44);
  bytes.set([0x01, 0x00, 0x00, 0x00]);
  bytes.set([0x20, 0x45, 0x4d, 0x46], 40);
  return bytes;
})();

const fakeApi = () => {
  const writes: string[] = [];
  return {
    writes,
    api: {
      ensureDirectory: jest.fn(async () => undefined),
      vectorizeGlyphImage: jest.fn(async () => ({
        svg: '<svg/>',
        threshold: 128,
        width: 20,
        height: 30,
      })),
      writeBinaryFile: jest.fn(async (filePath: string) => {
        writes.push(filePath);
      }),
      writeFile: jest.fn(async (filePath: string) => {
        writes.push(filePath);
      }),
    },
  };
};

describe('convertImportedGaiji', () => {
  const originalCrypto = globalThis.crypto;
  beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    }
  });
  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
  });

  it('declares identical images once, references them in place, and marks failures', async () => {
    const { api, writes } = fakeApi();
    const result = await convertImportedGaiji({
      api,
      images: [
        { contentType: 'image/png', bytes: PNG_A },
        { contentType: 'image/png', bytes: PNG_A.slice() },
        { contentType: 'image/x-emf', bytes: EMF },
      ],
      mode: 'charDecl',
      outputPath: '/project/texts/doc.xml',
      xml: TEI,
    });

    expect(result).toMatchObject({ converted: 2, failed: 1 });
    expect(api.vectorizeGlyphImage).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      expect.stringMatching(/^\/project\/texts\/_glyphs\/glyph-[0-9a-f]{16}\.png$/),
      expect.stringMatching(/^\/project\/texts\/_glyphs\/glyph-[0-9a-f]{16}\.svg$/),
    ]);

    const id = /glyph-[0-9a-f]{16}/.exec(writes[0])![0];
    expect(result.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(result.xml).toContain(
      `<p>天<g type="glyph" n="${id}" ref="#${id}"/>地<g type="glyph" n="${id}" ref="#${id}"/>人〓</p>`,
    );
    expect(result.xml.match(/<glyph /g)).toHaveLength(1);
    expect(result.xml).toContain(`<graphic type="normalized" url="_glyphs/${id}.svg"`);
    expect(
      new DOMParser().parseFromString(result.xml, 'application/xml').querySelector('parsererror'),
    ).toBeNull();
  });

  it('uses inline <graphic> for TEI Lite', async () => {
    const { api } = fakeApi();
    const result = await convertImportedGaiji({
      api,
      images: [{ contentType: 'image/png', bytes: PNG_A }],
      mode: 'graphic',
      outputPath: '/project/doc.xml',
      xml: '<TEI><text><body><p>a0b</p></body></text></TEI>',
    });
    expect(result.xml).toMatch(
      /<p>a<graphic type="glyph" url="_glyphs\/glyph-[0-9a-f]{16}\.svg" mimeType="image\/svg\+xml" width="20" height="30"\/>b<\/p>/,
    );
    expect(result.xml).not.toContain('charDecl');
  });
});

describe('gaijiModeForCatalog', () => {
  it('picks the glyph mechanism each schema supports', () => {
    expect(gaijiModeForCatalog('teiAll')).toBe('charDecl');
    expect(gaijiModeForCatalog('teiLite')).toBe('graphic');
    expect(gaijiModeForCatalog('orlando')).toBeNull();
  });
});
