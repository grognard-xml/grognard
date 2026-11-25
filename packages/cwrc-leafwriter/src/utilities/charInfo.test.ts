import { getCharInfo, preloadCharInfo, variantList } from './charInfo';

jest.mock('../resources/charInfo/charInfoIndex.json', () => ({
  謀: {
    cp: 'U+8B00',
    strokes: '16',
    pinyin: 'móu',
    definition: 'plan; scheme',
    variants: '某 谟',
  },
}));

describe('charInfo', () => {
  it('looks up a character after preload', async () => {
    await preloadCharInfo();
    const info = await getCharInfo('謀');
    expect(info?.cp).toBe('U+8B00');
    expect(info?.pinyin).toBe('móu');
    expect(variantList(info)).toEqual(['某', '谟']);
  });

  it('returns null for unknown characters', async () => {
    expect(await getCharInfo('☺')).toBeNull();
  });
});
