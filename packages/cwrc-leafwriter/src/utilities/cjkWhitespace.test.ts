import { stripCjkWhitespace, stripCjkWhitespaceInElement } from './cjkWhitespace';

describe('stripCjkWhitespace', () => {
  it('removes spaces between CJK characters', () => {
    expect(stripCjkWhitespace('漢 唐 宋')).toBe('漢唐宋');
  });

  it('removes line breaks and indentation between characters', () => {
    expect(stripCjkWhitespace('上陽子\n        曰：太上')).toBe('上陽子曰：太上');
  });

  it('cleans whitespace around CJK punctuation and full-width forms', () => {
    expect(stripCjkWhitespace('太上 ， 洞玄')).toBe('太上，洞玄');
  });

  it('handles Japanese, Korean, and Tibetan', () => {
    expect(stripCjkWhitespace('ひらがな カタカナ')).toBe('ひらがなカタカナ');
    expect(stripCjkWhitespace('한국 어')).toBe('한국어');
    expect(stripCjkWhitespace('བོད་ ཡིག')).toBe('བོད་ཡིག');
  });

  it('removes exotic Unicode spaces (nbsp, em/en) between CJK — the □ boxes', () => {
    expect(stripCjkWhitespace('第二弟也 「詔」')).toBe('第二弟也「詔」'); // nbsp
    expect(stripCjkWhitespace('符 宏於')).toBe('符宏於'); // em space
    expect(stripCjkWhitespace('破桓 亮')).toBe('破桓亮'); // thin space
  });

  it('removes the ideographic (long) space U+3000 between CJK characters', () => {
    expect(stripCjkWhitespace('漢　唐')).toBe('漢唐');
    expect(stripCjkWhitespace('漢 　 唐')).toBe('漢唐');
    expect(stripCjkWhitespace('第二弟也　「詔」')).toBe('第二弟也「詔」');
  });

  it('leaves Latin text untouched — safe on any document', () => {
    expect(stripCjkWhitespace('New   York')).toBe('New York');
    expect(stripCjkWhitespace('the City of London')).toBe('the City of London');
    expect(stripCjkWhitespace('end.  Next')).toBe('end.  Next');
  });

  it('keeps spaces separating Latin from CJK (only strips between EA chars)', () => {
    expect(stripCjkWhitespace('漢 Han 唐')).toBe('漢 Han 唐');
  });

  it('trims whitespace adjacent to CJK at the edges', () => {
    expect(stripCjkWhitespace('  漢唐  ')).toBe('漢唐');
  });
});

describe('stripCjkWhitespaceInElement', () => {
  it('strips inter-character whitespace across text nodes, keeping tags', () => {
    const doc = new DOMParser().parseFromString(
      `<TEI xmlns="http://www.tei-c.org/ns/1.0"><p><persName>上 陽 子</persName>曰 ：太上</p></TEI>`,
      'application/xml',
    );
    stripCjkWhitespaceInElement(doc);
    const xml = new XMLSerializer().serializeToString(doc);
    expect(xml).toBe(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><p><persName>上陽子</persName>曰：太上</p></TEI>',
    );
  });
});
