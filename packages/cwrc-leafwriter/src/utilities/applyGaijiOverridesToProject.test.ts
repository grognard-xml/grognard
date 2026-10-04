import { applyGaijiOverridesToXml } from './applyGaijiOverridesToProject';

const g = (id: string, extra = '') =>
  `<g type="kanripo" n="${id}"><graphic url="_gaiji/${id}.png" height="1em"${extra}/></g>`;

describe('applyGaijiOverridesToXml', () => {
  it('replaces matching Kanripo gaiji with the character and counts them', () => {
    const xml = `<p>旋龜${g('KR2112')}魚${g('KR2112')}</p>`;
    expect(applyGaijiOverridesToXml(xml, { KR2112: '𪁺' })).toEqual({
      xml: '<p>旋龜𪁺魚𪁺</p>',
      replaced: 2,
    });
  });

  it('leaves gaiji without an entry, non-kanripo <g> elements and other ids alone', () => {
    const xml = `<p>${g('KR9999')}<g type="glyph" n="x" ref="#x"/><g type="kanripo" n="KR1"><graphic url="a"/></g></p>`;
    expect(applyGaijiOverridesToXml(xml, { KR2112: '𪁺' })).toEqual({ xml, replaced: 0 });
  });

  it('handles attribute order and whitespace, and escapes IDS text', () => {
    const xml = '<p><g n="KR2112" type="kanripo">\n  <graphic url="a" />\n</g></p>';
    expect(applyGaijiOverridesToXml(xml, { KR2112: '[⿰魚&甬]' })).toEqual({
      xml: '<p>[⿰魚&amp;甬]</p>',
      replaced: 1,
    });
  });

  const VECTORISED = (extra = '') =>
    `<TEI><teiHeader><fileDesc/><encodingDesc>\n    <charDecl>\n      <glyph xml:id="glyph-aa">` +
    `<mapping type="kanripo">KR2112</mapping><graphic type="source" url="_glyphs/a.png"/>` +
    `<graphic type="normalized" url="_glyphs/a.svg" width="1" height="1"/></glyph>${extra}\n    </charDecl>\n  </encodingDesc></teiHeader>` +
    `<text><body><p>旋龜<g type="glyph" n="glyph-aa" ref="#glyph-aa"/>魚<g ref="#glyph-aa" type="glyph" n="glyph-aa"></g></p></body></text></TEI>`;

  it('resolves vectorised glyphs through their kanripo mapping and drops the unused declaration', () => {
    const result = applyGaijiOverridesToXml(VECTORISED(), { KR2112: '𪁺' });
    expect(result.replaced).toBe(2);
    expect(result.xml).toContain('<p>旋龜𪁺魚𪁺</p>');
    expect(result.xml).not.toContain('<glyph');
    expect(result.xml).not.toContain('<charDecl');
    expect(result.xml).not.toContain('<encodingDesc');
  });

  it('keeps vectorised glyphs whose id has no entry, and keeps other declarations', () => {
    const untouched = VECTORISED();
    expect(applyGaijiOverridesToXml(untouched, { KR9999: '字' })).toEqual({
      xml: untouched,
      replaced: 0,
    });
    const other = '<glyph xml:id="glyph-bb"><graphic type="source" url="_glyphs/b.png"/></glyph>';
    const result = applyGaijiOverridesToXml(VECTORISED(other), { KR2112: '𪁺' });
    expect(result.xml).toContain('glyph-bb');
    expect(result.xml).toContain('<charDecl');
    expect(result.xml).not.toContain('glyph-aa');
  });
});
