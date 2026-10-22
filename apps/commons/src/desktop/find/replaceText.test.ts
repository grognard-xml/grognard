import {
  applyRegexReplacement,
  isReplaceableSourceHit,
  isReplaceableTextHit,
  replaceAllInContent,
  replaceHitAtOffset,
} from './replaceText';
import { validateAndReplaceAll, validateAndReplaceHit } from './replaceValidation';

const sampleXml =
  '<?xml version="1.0"?><TEI><text><body><p>Hello world</p><p>中<place>国</place></p></body></text></TEI>';

describe('replaceText', () => {
  test('isReplaceableTextHit accepts a match inside one text run', () => {
    const start = sampleXml.indexOf('Hello');
    const end = start + 'Hello'.length;
    expect(isReplaceableTextHit(sampleXml, start, end)).toBe(true);
  });

  test('isReplaceableTextHit rejects a match spanning markup', () => {
    const start = sampleXml.indexOf('中');
    const end = sampleXml.indexOf('</place>');
    expect(isReplaceableTextHit(sampleXml, start, end)).toBe(false);
  });

  test('isReplaceableSourceHit accepts a raw XML tag match', () => {
    const start = sampleXml.indexOf('</p>');
    const end = start + '</p>'.length;
    expect(isReplaceableSourceHit(sampleXml, start, end)).toBe(true);
  });

  test('replaceHitAtOffset splices literal replacement', () => {
    const start = sampleXml.indexOf('world');
    const end = start + 'world'.length;
    const next = replaceHitAtOffset(sampleXml, start, end, 'there');
    expect(next).toContain('Hello there');
    expect(next).not.toContain('Hello world');
  });

  test('applyRegexReplacement substitutes capture groups', () => {
    const match = /(\w+) (\w+)/.exec('Hello world');
    expect(match).not.toBeNull();
    expect(applyRegexReplacement(match!, '$2, $1')).toBe('world, Hello');
    expect(applyRegexReplacement(match!, '$$')).toBe('$');
  });

  test('applyRegexReplacement substitutes \\1 backrefs', () => {
    const match = /(第[一二三十])/.exec('第一');
    expect(match).not.toBeNull();
    expect(applyRegexReplacement(match!, '第<number>\\1</number>')).toBe('第<number>第一</number>');
  });

  test('replaceAllInContent replaces only replaceable hits', () => {
    const xml = '<root><p>aa bb aa</p><p>中<place>国</place></p></root>';
    const { content, count, skippedNonReplaceable } = replaceAllInContent(xml, 'aa', 'xx', false);
    expect(count).toBe(2);
    expect(skippedNonReplaceable).toBe(0);
    expect(content).toContain('<p>xx bb xx</p>');
  });

  test('replaceAllInContent skips hits that cross markup when regex spans tags', () => {
    const xml = '<root><p>中<place>国</place></p></root>';
    const { count, skippedNonReplaceable } = replaceAllInContent(xml, '中.*国', '泰国', true);
    expect(count).toBe(0);
    expect(skippedNonReplaceable).toBe(1);
  });

  test('a regex replacement with \\n inserts a real new line and splits the paragraph', () => {
    const xml = '<root><p>前文音義<note>注</note></p></root>';
    const { content, count } = replaceAllInContent(
      xml,
      '音義<note',
      '</p>\\n<p>音義<note',
      true,
      false,
      true,
    );

    expect(count).toBe(1);
    expect(content).toBe('<root><p>前文</p>\n<p>音義<note>注</note></p></root>');
  });

  test('without regex mode a \\n in the replacement is left as typed', () => {
    const xml = '<root><p>aa</p></root>';
    const { content } = replaceAllInContent(xml, 'aa', 'x\\ny', false);
    expect(content).toBe('<root><p>x\\ny</p></root>');
  });

  test('replaceAllInContent can replace raw XML when markup is allowed', () => {
    const xml = '<root><p><persName>Ada</persName></p></root>';
    const { content, count, skippedNonReplaceable } = replaceAllInContent(
      xml,
      '</persName>',
      '</name>',
      false,
      false,
      true,
    );

    expect(count).toBe(1);
    expect(skippedNonReplaceable).toBe(0);
    expect(content).toBe('<root><p><persName>Ada</name></p></root>');
  });
});

describe('replaceValidation', () => {
  test('validateAndReplaceHit succeeds for safe literal replace', () => {
    const start = sampleXml.indexOf('world');
    const end = start + 'world'.length;
    const outcome = validateAndReplaceHit(sampleXml, start, end, 'there', false, 'world');
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toContain('Hello there');
  });

  test('validateAndReplaceHit rejects cross-markup hit', () => {
    const start = sampleXml.indexOf('中');
    const end = sampleXml.indexOf('</place>');
    const outcome = validateAndReplaceHit(sampleXml, start, end, '泰国', false, '中国');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('crosses XML markup');
  });

  test('validateAndReplaceHit allows well-formed source markup replacement', () => {
    const xml = '<root><p>Ada<lb/></p></root>';
    const start = xml.indexOf('<lb/>');
    const end = start + '<lb/>'.length;
    const outcome = validateAndReplaceHit(xml, start, end, '<br/>', false, '<lb/>', false, true);

    expect(outcome.ok).toBe(true);
    expect(outcome.content).toBe('<root><p>Ada<br/></p></root>');
  });

  test('validateAndReplaceAll allows matching source XML tags when result is well formed', () => {
    const xml = '<root><p><persName>Ada</persName></p></root>';
    const outcome = validateAndReplaceAll(xml, 'persName', 'name', false, false, true);

    expect(outcome.ok).toBe(true);
    expect(outcome.count).toBe(2);
    expect(outcome.content).toBe('<root><p><name>Ada</name></p></root>');
  });

  test('validateAndReplaceHit rejects invalid XML result', () => {
    const xml = '<p>Hello</p>';
    const start = xml.indexOf('Hello');
    const end = start + 'Hello'.length;
    const outcome = validateAndReplaceHit(xml, start, end, 'Hello<', false, 'Hello');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('invalid XML');
  });

  test('validateAndReplaceAll validates whole file after batch replace', () => {
    const xml = '<root><p>cat cat</p><p>dog</p></root>';
    const outcome = validateAndReplaceAll(xml, 'cat', 'bird', false);
    expect(outcome.ok).toBe(true);
    expect(outcome.count).toBe(2);
    expect(outcome.content).toContain('<p>bird bird</p>');
  });
});
