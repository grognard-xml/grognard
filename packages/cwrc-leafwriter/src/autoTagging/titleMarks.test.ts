import { stripTitleMarks } from './titleMarks';

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
