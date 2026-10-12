import { cleanEntityName, stripInvisibleChars, stripTitleMarks } from './titleMarks';

describe('stripTitleMarks', () => {
  it.each([
    ['《史記》', '史記'],
    ['〈高祖本紀〉', '高祖本紀'],
    ['『源氏物語』', '源氏物語'],
    ['「高祖本紀」', '高祖本紀'],
    ['《史記·〈高祖本紀〉》', '史記·高祖本紀'],
    ['  《禮斗威儀》 ', '禮斗威儀'],
    ['史記', '史記'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(stripTitleMarks(input)).toBe(expected);
  });

  it('keeps corner quotes that are not wrapping the whole string', () => {
    expect(stripTitleMarks('「曰」之說')).toBe('「曰」之說');
  });
});

describe('cleanEntityName', () => {
  it('removes invisible characters and title marks together', () => {
    expect(cleanEntityName('\uFEFF《史\u200B記》\u00AD')).toBe('史記');
    expect(stripInvisibleChars('a\u200Db\u2060c')).toBe('abc');
  });

  it('leaves ordinary text, including Tibetan marks, untouched', () => {
    expect(cleanEntityName('བོད་')).toBe('བོད་');
  });
});
