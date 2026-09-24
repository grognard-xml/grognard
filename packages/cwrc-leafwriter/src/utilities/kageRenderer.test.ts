import { composeKageData } from './kageCompose';
import { isKnownComponent, renderKageToSvg } from './kageRenderer';

describe('isKnownComponent', () => {
  it('finds an ordinary bundled Unicode component', () => {
    expect(isKnownComponent('u8a00')).toBe(true); // 言
  });

  it('does not find a made-up name', () => {
    expect(isKnownComponent('not-a-real-component')).toBe(false);
  });

  it('finds a name supplied via extraComponents', () => {
    expect(isKnownComponent('chhiv-0001', { 'chhiv-0001': '1:0:0:0:0:200:200' })).toBe(true);
  });
});

describe('renderKageToSvg', () => {
  it('renders a composition of two bundled components to a well-formed SVG with no unresolved refs', () => {
    const kageData = composeKageData('⿰', 'u8a00', 'u67d0'); // 言 / 某
    const result = renderKageToSvg(kageData);
    expect(result.unresolvedComponents).toEqual([]);
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('polygon');
  });

  it('still renders, but reports the gap, when a referenced component is missing', () => {
    const kageData = composeKageData('⿰', 'u8a00', 'totally-unknown-component');
    const result = renderKageToSvg(kageData);
    expect(result.unresolvedComponents).toEqual(['totally-unknown-component']);
    expect(result.svg).toContain('<svg'); // kage-engine omits the gap rather than throwing
  });

  it('resolves a component supplied via extraComponents (a project-local composed glyph)', () => {
    const previouslyComposed = composeKageData('⿱', 'u4e00', 'u4e8c'); // 一 / 二
    const kageData = composeKageData('⿰', 'u8a00', 'chhiv-0001');
    const result = renderKageToSvg(kageData, { 'chhiv-0001': previouslyComposed });
    expect(result.unresolvedComponents).toEqual([]);
    expect(result.svg).toContain('<svg');
  });
});
