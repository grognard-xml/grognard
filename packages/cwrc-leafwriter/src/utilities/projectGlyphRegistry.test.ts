import {
  addProjectGlyph,
  emptyProjectGlyphRegistry,
  getProjectGlyph,
  nextProjectGlyphId,
  parseProjectGlyphRegistry,
  projectGlyphKageComponentMap,
  serializeProjectGlyphRegistry,
  type ProjectGlyph,
} from './projectGlyphRegistry';

const makeGlyph = (overrides: Partial<ProjectGlyph> = {}): ProjectGlyph => ({
  id: 'chhiv-0001',
  svgRelativeUrl: '_glyphs/chhiv-0001.svg',
  sourceType: 'composed',
  createdAt: '2026-09-24T00:00:00.000Z',
  ...overrides,
});

describe('nextProjectGlyphId', () => {
  it('starts at chhiv-0001 for an empty registry', () => {
    expect(nextProjectGlyphId(emptyProjectGlyphRegistry())).toBe('chhiv-0001');
  });

  it('increments past the highest existing id, ignoring gaps', () => {
    const registry = addProjectGlyph(
      addProjectGlyph(emptyProjectGlyphRegistry(), makeGlyph({ id: 'chhiv-0001' })),
      makeGlyph({ id: 'chhiv-0017' }),
    );
    expect(nextProjectGlyphId(registry)).toBe('chhiv-0018');
  });
});

describe('addProjectGlyph', () => {
  it('replaces an existing entry with the same id rather than duplicating it', () => {
    let registry = addProjectGlyph(emptyProjectGlyphRegistry(), makeGlyph({ notes: 'first' }));
    registry = addProjectGlyph(registry, makeGlyph({ notes: 'second' }));
    expect(registry.glyphs).toHaveLength(1);
    expect(getProjectGlyph(registry, 'chhiv-0001')?.notes).toBe('second');
  });
});

describe('parseProjectGlyphRegistry', () => {
  it('round-trips through serialize/parse', () => {
    const registry = addProjectGlyph(emptyProjectGlyphRegistry(), makeGlyph());
    const parsed = parseProjectGlyphRegistry(serializeProjectGlyphRegistry(registry));
    expect(parsed).toEqual(registry);
  });

  it('degrades to an empty registry on unparsable content, rather than throwing', () => {
    expect(parseProjectGlyphRegistry('not json')).toEqual(emptyProjectGlyphRegistry());
    expect(parseProjectGlyphRegistry('{}')).toEqual(emptyProjectGlyphRegistry());
    expect(parseProjectGlyphRegistry('{"glyphs": "nope"}')).toEqual(emptyProjectGlyphRegistry());
  });

  it('drops malformed entries but keeps well-formed ones', () => {
    const json = JSON.stringify({
      version: 1,
      glyphs: [makeGlyph(), { id: 'missing-fields' }],
    });
    const parsed = parseProjectGlyphRegistry(json);
    expect(parsed.glyphs).toHaveLength(1);
    expect(parsed.glyphs[0].id).toBe('chhiv-0001');
  });
});

describe('projectGlyphKageComponentMap', () => {
  it('includes only composed glyphs that have kage data', () => {
    const registry = addProjectGlyph(
      addProjectGlyph(
        addProjectGlyph(
          emptyProjectGlyphRegistry(),
          makeGlyph({ id: 'chhiv-0001', kage: '1:0:0' }),
        ),
        makeGlyph({ id: 'chhiv-0002', sourceType: 'image', kage: undefined }),
      ),
      makeGlyph({ id: 'chhiv-0003', kage: undefined }),
    );
    expect(projectGlyphKageComponentMap(registry)).toEqual({ 'chhiv-0001': '1:0:0' });
  });
});
