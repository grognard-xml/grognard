import { expandIdsAbbreviations } from './kageCompose';

describe('expandIdsAbbreviations', () => {
  it('expands zi.tools / marinaMoji two-letter codes', () => {
    expect(expandIdsAbbreviations('LR言某')).toBe('⿰言某');
    expect(expandIdsAbbreviations('lr日月')).toBe('⿰日月');
    expect(expandIdsAbbreviations('UD木口')).toBe('⿱木口');
    expect(expandIdsAbbreviations('LL木木木')).toBe('⿲木木木');
    expect(expandIdsAbbreviations('XX中')).toBe('⿻中');
  });

  it('leaves real IDS operators alone and expands nested abbreviations', () => {
    expect(expandIdsAbbreviations('⿰言某')).toBe('⿰言某');
    expect(expandIdsAbbreviations('LR木UD日月')).toBe('⿰木⿱日月');
  });

  it('leaves unknown letter pairs alone', () => {
    expect(expandIdsAbbreviations('AB木')).toBe('AB木');
  });
});
