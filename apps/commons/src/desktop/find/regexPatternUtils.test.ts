import {
  applyRegexReplacement,
  compileFindRegex,
  expandUnicodeWordShorthand,
} from './regexPatternUtils';

describe('expandUnicodeWordShorthand', () => {
  test('expands \\w to Unicode letters and numbers outside a class', () => {
    expect(expandUnicodeWordShorthand('(\\w+)')).toBe('([\\p{L}\\p{N}_]+)');
  });

  test('expands \\w inside a character class', () => {
    expect(expandUnicodeWordShorthand('[\\w-]')).toBe('[\\p{L}\\p{N}_-]');
  });

  test('leaves escaped \\\\w alone', () => {
    expect(expandUnicodeWordShorthand('\\\\w')).toBe('\\\\w');
  });
});

describe('compileFindRegex', () => {
  test('matches classical Chinese names with \\w', () => {
    const text = '除通直郎，';
    const regex = compileFindRegex('([轉遷除])(\\w+)([。，])');
    expect([...text.matchAll(regex)]).toHaveLength(1);
    expect([...text.matchAll(regex)][0]?.[2]).toBe('通直郎');
  });

  test('still matches ASCII word characters', () => {
    const regex = compileFindRegex('\\w+');
    expect('hello_9'.match(regex)?.[0]).toBe('hello_9');
  });
});

describe('applyRegexReplacement', () => {
  test('supports dollar, slash, and hash capture aliases', () => {
    const match = compileFindRegex('(甲)(\\w+)').exec('甲乙丙');
    expect(match).not.toBeNull();
    expect(applyRegexReplacement(match!, '$2-\\1-#2')).toBe('乙丙-甲-乙丙');
  });

  test('turns \\n, \\t and \\r into a new line, a tab and a carriage return', () => {
    const match = compileFindRegex('音義<note').exec('音義<note')!;
    expect(applyRegexReplacement(match, '</p>\\n<p>音義<note')).toBe('</p>\n<p>音義<note');
    expect(applyRegexReplacement(match, 'a\\tb\\r\\nc')).toBe('a\tb\r\nc');
  });

  test('keeps a backslash before anything else, and \\\\ is one backslash', () => {
    const match = compileFindRegex('(甲)').exec('甲')!;
    expect(applyRegexReplacement(match, 'a\\xb')).toBe('a\\xb');
    expect(applyRegexReplacement(match, 'a\\\\nb')).toBe('a\\nb');
    expect(applyRegexReplacement(match, 'end\\')).toBe('end\\');
  });

  test('still puts a backslash before a group when it is written \\\\1', () => {
    const match = compileFindRegex('(甲)').exec('甲')!;
    expect(applyRegexReplacement(match, '\\\\1')).toBe('\\甲');
  });

  test('handles $$, an unknown group and a dollar or hash with no number', () => {
    const match = compileFindRegex('(甲)').exec('甲')!;
    expect(applyRegexReplacement(match, '$$1 $9 \\9 # $ #x')).toBe('$1   # $ #x');
  });

  test('mixes groups and new lines', () => {
    const match = compileFindRegex('(甲)(乙)').exec('甲乙')!;
    expect(applyRegexReplacement(match, '$1\\n$2')).toBe('甲\n乙');
  });
});
