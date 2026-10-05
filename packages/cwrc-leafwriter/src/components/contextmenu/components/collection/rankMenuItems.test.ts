import type { ItemProps } from '../item';
import { rankMenuItems } from './rankMenuItems';

const tag = (name: string, fullName?: string): ItemProps => ({ name, fullName, type: 'tag' });

describe('rankMenuItems', () => {
  const list = [
    tag('q', 'quoted text'),
    tag('quotation'),
    tag('quote'),
    tag('cit', 'a citation containing a quote'),
    tag('p', 'paragraph'),
  ];

  it('puts the exact name first, then prefix matches, then name, then description matches', () => {
    expect(rankMenuItems(list, 'quote').map((i) => i.name)).toEqual(['quote', 'q', 'cit']);
    expect(rankMenuItems(list, 'quot').map((i) => i.name)).toEqual([
      'quotation',
      'quote',
      'q',
      'cit',
    ]);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(rankMenuItems(list, '  QUOTE ')[0].name).toBe('quote');
  });

  it('returns the list untouched for an empty query, and drops dividers when filtering', () => {
    const withDivider: ItemProps[] = [tag('a'), { name: 'divider', type: 'divider' }, tag('ab')];
    expect(rankMenuItems(withDivider, '')).toBe(withDivider);
    expect(rankMenuItems(withDivider, 'a').map((i) => i.name)).toEqual(['a', 'ab']);
  });

  it('keeps original order among equal ranks', () => {
    expect(rankMenuItems([tag('bx'), tag('ax'), tag('cx')], 'x').map((i) => i.name)).toEqual([
      'bx',
      'ax',
      'cx',
    ]);
  });
});
