import { preloadCharInfo } from './charInfo';
import {
  findAndSortContaining,
  findCharactersContaining,
  parseLookupQuery,
  sortByStrokes,
} from './idsContainingSearch';

jest.mock('../resources/ids/idsUnicodeIndex.json', () => [
  ['⿱廿木', '某'],
  ['⿰木目', '相'],
  ['⿰言某', '謀'],
  ['⿰言齒', '𪘙'],
  ['⿰業刂', '𠟪'],
  ['⿰氵甲', '一'],
  ['⿰水甲', '二'],
  // 讋 nests 龖, so 龍 appears twice one level down (marinaMoji fixture).
  ['⿱龍龍', '龖'],
  ['⿰言龖', '讋'],
  ['⿱竹龍', '籠'],
  ['木', '木'],
  ['言', '言'],
]);

jest.mock('../resources/charInfo/charInfoIndex.json', () => ({
  某: { strokes: '9' },
  相: { strokes: '9' },
  謀: { strokes: '16' },
  言: { strokes: '7' },
  木: { strokes: '4' },
  齒: { strokes: '12,15' },
  𪘙: { strokes: '20' },
  𠟪: { strokes: '10' },
  一: { strokes: '1' },
  二: { strokes: '2' },
  龖: { strokes: '32' },
  讋: { strokes: '24' },
  籠: { strokes: '22' },
}));

// Minimal radical families so 訁↔言, 刀↔刂, 氵↔水 match.
jest.mock('../resources/ids/radicalForms.json', () => ({
  auto: {},
  families: [
    ['言', '訁', '讠'],
    ['刀', '刂'],
    ['水', '氵'],
  ],
}));

describe('parseLookupQuery', () => {
  it('splits components from stroke filters', () => {
    expect(parseLookupQuery('木12').components).toBe('木');
    expect(parseLookupQuery('木12').strokes).toEqual({ min: 12, max: 12 });
    expect(parseLookupQuery('木<12').strokes).toEqual({ min: 0, max: 11 });
    expect(parseLookupQuery('木>8').strokes).toEqual({
      min: 9,
      max: Number.MAX_SAFE_INTEGER,
    });
    expect(parseLookupQuery('木9-12').strokes).toEqual({ min: 9, max: 12 });
    expect(parseLookupQuery('木>=8').strokes).toEqual({
      min: 8,
      max: Number.MAX_SAFE_INTEGER,
    });
    expect(parseLookupQuery('木>3 <9').strokes).toEqual({ min: 4, max: 8 });
    expect(parseLookupQuery('12 木 言').components).toBe('木言');
    expect(parseLookupQuery('木言').strokes).toBeNull();
  });
});

describe('findCharactersContaining', () => {
  beforeAll(async () => {
    await preloadCharInfo();
  });

  it('finds characters that contain a component at any depth', () => {
    expect(findCharactersContaining('木')).toEqual(expect.arrayContaining(['某', '相', '謀']));
  });

  it('requires every component', () => {
    expect(findCharactersContaining('木目')).toEqual(['相']);
    expect(findCharactersContaining('言木')).toEqual(['謀']);
    expect(findCharactersContaining('目言')).toEqual([]);
  });

  it('counts repeated components', () => {
    expect(findCharactersContaining('龍')).toEqual(expect.arrayContaining(['籠', '讋', '龖']));
    expect(findCharactersContaining('龍龍')).toEqual(expect.arrayContaining(['讋', '龖']));
    expect(findCharactersContaining('龍龍龍')).toEqual([]);
  });

  it('treats radical forms as one component', () => {
    expect(findCharactersContaining('訁')).toEqual(expect.arrayContaining(['謀', '𪘙']));
    expect(findCharactersContaining('刀')).toEqual(['𠟪']);
    expect(findCharactersContaining('氵')).toEqual(expect.arrayContaining(['一', '二']));
  });

  it('filters by stroke count from char_info', () => {
    expect(findCharactersContaining('木', { min: 9, max: 9 })).toEqual(
      expect.arrayContaining(['某', '相']),
    );
    expect(findCharactersContaining('木', { min: 9, max: 9 })).not.toContain('謀');
    expect(findCharactersContaining('木', { min: 10, max: 20 })).toEqual(['謀']);
    expect(findCharactersContaining('言木', { min: 16, max: 16 })).toEqual(['謀']);
  });
});

describe('findAndSortContaining', () => {
  beforeAll(async () => {
    await preloadCharInfo();
  });

  it('parses the field, sorts by strokes, and reports truncation metadata', () => {
    const result = findAndSortContaining('木');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.shown[0]).toBe(sortByStrokes(result.matches)[0]);
    expect(result.lookup.components).toBe('木');
    expect(result.lookup.strokes).toBeNull();
  });
});
