import { getTeiXPathAtOffset } from './teiXPath';
import {
  findElementOpenTagStartInXml,
  findTextOffsetInXml,
  mapSourceOffsetToVisualCaret,
  mapVisualCaretToSourceOffset,
} from './sourceCursorSync';

const sample = `<?xml version="1.0"?>
<TEI>
  <text>
    <body>
      <cb:div>
        <list>
          <item>First</item>
          <item>Second</item>
          <item>Third</item>
        </list>
      </cb:div>
    </body>
  </text>
</TEI>`;

describe('findTextOffsetInXml', () => {
  test('maps start of third item text', () => {
    const xpath = '/TEI/text/body/cb:div/list/item[3]';
    const expected = sample.indexOf('Third');
    expect(findTextOffsetInXml(sample, xpath, 0)).toBe(expected);
  });

  test('maps offset within third item text', () => {
    const xpath = '/TEI/text/body/cb:div/list/item[3]';
    const start = sample.indexOf('Third');
    expect(findTextOffsetInXml(sample, xpath, 2)).toBe(start + 2);
  });

  test('maps first item without sibling index in xpath', () => {
    const xpath = '/TEI/text/body/cb:div/list/item';
    expect(findTextOffsetInXml(sample, xpath, 0)).toBe(sample.indexOf('First'));
  });

  test('returns null for unknown xpath', () => {
    expect(findTextOffsetInXml(sample, '/TEI/text/body/missing', 0)).toBeNull();
  });
});

describe('findElementOpenTagStartInXml', () => {
  test('finds opening tag for indexed item', () => {
    const xpath = '/TEI/text/body/cb:div/list/item[3]';
    const start = findElementOpenTagStartInXml(sample, xpath);
    expect(start).not.toBeNull();
    expect(sample.slice(start!, start! + 6)).toBe('<item>');
  });
});

describe('mapVisualCaretToSourceOffset', () => {
  test('round-trips xpath at offset via getTeiXPathAtOffset', () => {
    const sourceOffset = sample.indexOf('Second') + 3;
    const xpath = getTeiXPathAtOffset(sample, sourceOffset);
    expect(xpath).not.toBeNull();

    const mapped = mapVisualCaretToSourceOffset(sample, {
      teiXPath: xpath!,
      offsetInElementText: 3,
    });
    expect(mapped).toBe(sourceOffset);
  });
});

describe('mapSourceOffsetToVisualCaret', () => {
  const itemXPath = (n: number) => `/TEI/text/body/cb:div/list/item${n === 1 ? '' : `[${n}]`}`;

  test('maps a cursor inside the third item', () => {
    const offset = sample.indexOf('Third') + 2;
    expect(mapSourceOffsetToVisualCaret(sample, offset)).toEqual({
      teiXPath: itemXPath(3),
      offsetInElementText: 2,
    });
  });

  test('maps the start and the end of an item', () => {
    const start = sample.indexOf('Second');
    expect(mapSourceOffsetToVisualCaret(sample, start)).toEqual({
      teiXPath: itemXPath(2),
      offsetInElementText: 0,
    });
    expect(mapSourceOffsetToVisualCaret(sample, start + 'Second'.length)).toEqual({
      teiXPath: itemXPath(2),
      offsetInElementText: 6,
    });
  });

  test('counts an entity as one character', () => {
    const xml = '<TEI><text><body><p>a&amp;b&#8211;cd</p></body></text></TEI>';
    const offset = xml.indexOf('cd');
    expect(mapSourceOffsetToVisualCaret(xml, offset)?.offsetInElementText).toBe(4);
  });

  test('counts the text of child elements before the cursor', () => {
    const xml = '<TEI><text><body><p>one <hi>two</hi> three</p></body></text></TEI>';
    const offset = xml.indexOf('three') + 2;
    expect(mapSourceOffsetToVisualCaret(xml, offset)).toEqual({
      teiXPath: '/TEI/text/body/p',
      offsetInElementText: 'one two '.length + 2,
    });
  });

  test('places a cursor inside a child element in that element', () => {
    const xml = '<TEI><text><body><p>one <hi>two</hi> three</p></body></text></TEI>';
    const offset = xml.indexOf('two') + 1;
    expect(mapSourceOffsetToVisualCaret(xml, offset)).toEqual({
      teiXPath: '/TEI/text/body/p/hi',
      offsetInElementText: 1,
    });
  });

  test('maps a cursor inside an opening tag to the start of that element', () => {
    const offset = sample.indexOf('<item>Second') + 3;
    expect(mapSourceOffsetToVisualCaret(sample, offset)).toEqual({
      teiXPath: itemXPath(2),
      offsetInElementText: 0,
    });
  });

  test('maps a cursor inside a closing tag to the end of that element', () => {
    const offset = sample.indexOf('</item>', sample.indexOf('Second')) + 3;
    expect(mapSourceOffsetToVisualCaret(sample, offset)).toEqual({
      teiXPath: itemXPath(2),
      offsetInElementText: 6,
    });
  });

  test('keeps counting past a self-closing element', () => {
    const xml = '<TEI><text><body><p>ab<lb/>cd</p></body></text></TEI>';
    expect(mapSourceOffsetToVisualCaret(xml, xml.indexOf('cd') + 1)).toEqual({
      teiXPath: '/TEI/text/body/p',
      offsetInElementText: 3,
    });
  });

  test('numbers repeated siblings like the editor does', () => {
    const xml = '<TEI><text><body><p>a</p><p>b</p><p>c</p></body></text></TEI>';
    expect(mapSourceOffsetToVisualCaret(xml, xml.indexOf('c'))?.teiXPath).toBe(
      '/TEI/text/body/p[3]',
    );
  });

  test('returns null outside the root element and for bad offsets', () => {
    expect(mapSourceOffsetToVisualCaret(sample, 0)).toBeNull();
    expect(mapSourceOffsetToVisualCaret(sample, -1)).toBeNull();
    expect(mapSourceOffsetToVisualCaret(sample, sample.length + 5)).toBeNull();
  });

  test('is the inverse of mapVisualCaretToSourceOffset for text in an element', () => {
    for (const word of ['First', 'Second', 'Third']) {
      for (let k = 0; k <= word.length; k++) {
        const offset = sample.indexOf(word) + k;
        const caret = mapSourceOffsetToVisualCaret(sample, offset);
        expect(caret).not.toBeNull();
        expect(mapVisualCaretToSourceOffset(sample, caret!)).toBe(offset);
      }
    }
  });
});
