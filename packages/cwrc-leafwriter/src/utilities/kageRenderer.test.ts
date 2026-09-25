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
    const kageData = composeKageData('⿰', ['u8a00', 'u67d0']); // 言 / 某
    const result = renderKageToSvg(kageData);
    expect(result.unresolvedComponents).toEqual([]);
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('polygon');
  });

  it('still renders, but reports the gap, when a referenced component is missing', () => {
    const kageData = composeKageData('⿰', ['u8a00', 'totally-unknown-component']);
    const result = renderKageToSvg(kageData);
    expect(result.unresolvedComponents).toEqual(['totally-unknown-component']);
    expect(result.svg).toContain('<svg'); // kage-engine omits the gap rather than throwing
  });

  it('resolves a component supplied via extraComponents (a project-local composed glyph)', () => {
    const previouslyComposed = composeKageData('⿱', ['u4e00', 'u4e8c']); // 一 / 二
    const kageData = composeKageData('⿰', ['u8a00', 'chhiv-0001']);
    const result = renderKageToSvg(kageData, { 'chhiv-0001': previouslyComposed });
    expect(result.unresolvedComponents).toEqual([]);
    expect(result.svg).toContain('<svg');
  });

  it('renders a real GlyphWiki-style "@N" component reference, not just the composer\'s own suffix-free ones', () => {
    // Regression: a real adopted GlyphWiki entry's own "99:" records commonly
    // carry a trailing "@N" render-parameter suffix on the component name
    // (e.g. "u7259@4") - kage-engine does NOT strip that itself when
    // resolving against kBuhin (confirmed empirically), so without stripping
    // it ourselves this silently rendered as an empty glyph: 0 polygons,
    // *and* an empty unresolvedComponents list (which does strip "@N" for
    // its own existence check), so the bug was invisible to that safety net.
    const kageData = '99:0:0:-1:-5:100:197:u7259@4:0:0:0$99:0:0:81:0:197:200:u9f52@3:0:0:0';
    const result = renderKageToSvg(kageData);
    expect(result.unresolvedComponents).toEqual([]);
    expect(result.svg.match(/<polygon/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it('reports an unresolved component nested inside an extraComponents entry, not just the top-level record (Phase D)', () => {
    // Regression: findUnresolved used to check only kageData's own two
    // refs, never what an extraComponents entry's *own* refs pointed to.
    // Phase D's tree preview feeds in not-yet-validated synthetic
    // sub-compositions via extraComponents, so a broken leaf several levels
    // down produced an empty unresolvedComponents list at the root - the
    // exact "clean render is not proof of resolution" failure mode this
    // module already exists to guard against, just one level removed.
    const brokenNestedComponent = composeKageData('⿱', ['not-a-real-thing', 'u5973']); // 女
    const kageData = composeKageData('⿰', ['u8a00', '__nested_0__']);
    const result = renderKageToSvg(kageData, { __nested_0__: brokenNestedComponent });
    expect(result.unresolvedComponents).toEqual(['not-a-real-thing']);
  });
});
