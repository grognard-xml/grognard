import {
  GLYPH_SELECTOR,
  insertTranslationGlyphFromImageFile,
  prepareAtomicGlyphFields,
  translationGlyphImageUnavailableReason,
} from './translationGlyphs';

describe('translationGlyphImageUnavailableReason', () => {
  const originalApi = window.electronAPI;

  afterEach(() => {
    window.electronAPI = originalApi;
  });

  it('requires a saved translation path', () => {
    window.electronAPI = {
      vectorizeGlyphImage: async () => ({ svg: '<svg/>', width: 1, height: 1 }),
      writeBinaryFile: async () => {},
    } as unknown as typeof window.electronAPI;

    expect(translationGlyphImageUnavailableReason(null)).toBe(
      'LW.translationPane.glyphUnavailableNoFile',
    );
  });

  it('requires the vectorization API to be present', () => {
    window.electronAPI = {} as unknown as typeof window.electronAPI;

    expect(translationGlyphImageUnavailableReason('/docs/translation.xml')).toBe(
      'LW.translationPane.glyphUnavailableNoApi',
    );
  });

  it('is available with a path and a working API', () => {
    window.electronAPI = {
      vectorizeGlyphImage: async () => ({ svg: '<svg/>', width: 1, height: 1 }),
      writeBinaryFile: async () => {},
    } as unknown as typeof window.electronAPI;

    expect(translationGlyphImageUnavailableReason('/docs/translation.xml')).toBeNull();
  });
});

describe('prepareAtomicGlyphFields', () => {
  it('marks every glyph non-editable and applies the mask layout CSS', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<graphic type="glyph" url="_glyphs/g1.svg" width="10" height="10"></graphic>text';

    prepareAtomicGlyphFields(root, '/docs/translation.xml');

    const graphic = root.querySelector(GLYPH_SELECTOR) as HTMLElement;
    expect(graphic.getAttribute('contenteditable')).toBe('false');
    expect(graphic.style.display).toBe('inline-block');
    expect(graphic.style.width).toBe('1em');
    expect(graphic.style.backgroundColor).toBe('currentcolor');
  });

  it('does nothing when there are no glyphs', () => {
    const root = document.createElement('div');
    root.innerHTML = 'plain text, no glyphs here';
    expect(() => prepareAtomicGlyphFields(root, '/docs/translation.xml')).not.toThrow();
  });
});

describe('insertTranslationGlyphFromImageFile', () => {
  const originalApi = window.electronAPI;

  afterEach(() => {
    window.electronAPI = originalApi;
  });

  it('vectorizes, saves the asset, and inserts a bare <graphic type="glyph"> at the cursor', async () => {
    const writeBinaryFile = jest.fn().mockResolvedValue(undefined);
    const writeFile = jest.fn().mockResolvedValue(undefined);
    const ensureDirectory = jest.fn().mockResolvedValue(undefined);
    window.electronAPI = {
      vectorizeGlyphImage: async () => ({ svg: '<svg>ink</svg>', width: 42, height: 49 }),
      writeBinaryFile,
      writeFile,
      ensureDirectory,
    } as unknown as typeof window.electronAPI;

    document.body.innerHTML = '<div id="root">before after</div>';
    const root = document.getElementById('root')!;
    const textNode = root.firstChild! as Text;
    const range = document.createRange();
    range.setStart(textNode, 6); // "before" | " after" -> right after "before"
    range.collapse(true);

    // jsdom's File/Blob doesn't implement arrayBuffer() - polyfill just this instance.
    const file = new File([new Uint8Array([1, 2, 3])], 'char.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const inserted = await insertTranslationGlyphFromImageFile(
      '/docs/translation.xml',
      file,
      range,
    );

    expect(inserted).toBe(true);
    expect(ensureDirectory).toHaveBeenCalledWith('/docs/_glyphs');
    expect(writeBinaryFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);

    const graphic = root.querySelector(GLYPH_SELECTOR)!;
    expect(graphic).not.toBeNull();
    expect(graphic.getAttribute('mimeType')).toBe('image/svg+xml');
    expect(graphic.getAttribute('width')).toBe('42');
    expect(graphic.getAttribute('height')).toBe('49');
    expect(graphic.getAttribute('url')).toMatch(/^_glyphs\/.+\.svg$/);
    // split "before after" around the inserted glyph
    expect(root.textContent).toBe('before after');
    expect(root.firstChild?.textContent).toBe('before');
    expect(root.lastChild?.textContent).toBe(' after');
  });

  it('returns false when the vectorization API is unavailable', async () => {
    window.electronAPI = {} as unknown as typeof window.electronAPI;
    document.body.innerHTML = '<div id="root">text</div>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('root')!);
    range.collapse(true);

    const file = new File([new Uint8Array([1])], 'char.png', { type: 'image/png' });
    const inserted = await insertTranslationGlyphFromImageFile(
      '/docs/translation.xml',
      file,
      range,
    );

    expect(inserted).toBe(false);
  });
});
