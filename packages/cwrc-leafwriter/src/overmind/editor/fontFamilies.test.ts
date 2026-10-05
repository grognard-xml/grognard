import { buildEditorFontCss, combineFontFamilies, DEFAULT_LATIN_FONT } from './fontFamilies';

describe('combineFontFamilies', () => {
  it('puts the Asian font after the Latin fonts and drops the Latin generic', () => {
    expect(combineFontFamilies('Arial, Helvetica, sans-serif', '"BabelStone Han", serif')).toBe(
      'Arial, Helvetica, "BabelStone Han", serif',
    );
  });

  it('keeps quoted names (even with commas) and handles the default system stack', () => {
    const combined = combineFontFamilies(DEFAULT_LATIN_FONT, '"BabelStone Han"');
    expect(combined).toBe(
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, Helvetica, "BabelStone Han"',
    );
    expect(combineFontFamilies('"Foo, Bar", serif', 'X')).toBe('"Foo, Bar", X');
  });

  it('works when the Latin list is only a generic', () => {
    expect(combineFontFamilies('sans-serif', '"BabelStone Han"')).toBe('"BabelStone Han"');
  });
});

describe('buildEditorFontCss', () => {
  it('applies the combined stack to body and, more specifically, to the root element', () => {
    const css = buildEditorFontCss('Arial, sans-serif', '"BabelStone Han"', ':lang(zh)');
    expect(css).toMatch(/body\s*\{\s*font-family: Arial, "BabelStone Han";/);
    expect(css).toMatch(/body > \*\[_tag\]\s*\{\s*font-family: Arial, "BabelStone Han";/);
    expect(css).toMatch(/:lang\(zh\)\s*\{\s*font-family: "BabelStone Han";/);
  });
});
