import { parseValidInsertions, verifySegmentInsertions } from './verifyInsertions';

describe('parseValidInsertions', () => {
  it('accepts valid anchor insertions and rejects bad marks', () => {
    const json = JSON.stringify({
      insertions: [
        { mark: '。', left: '之', occurrence: 1 },
        { mark: '(', left: '甲', occurrence: 1 },
      ],
    });
    const items = parseValidInsertions(json);
    expect(items).toHaveLength(1);
    expect(items[0]?.mark).toBe('。');
  });

  it('returns empty on malformed JSON', () => {
    expect(parseValidInsertions('not json')).toEqual([]);
  });
});

describe('verifySegmentInsertions', () => {
  const han = '學而時習之不亦說乎';

  it('resolves left+occurrence to afterHan', () => {
    const { verified, dropped } = verifySegmentInsertions(
      han,
      [{ mark: '，', left: '之', occurrence: 1 }],
      10,
    );
    expect(dropped).toBe(0);
    expect(verified).toHaveLength(1);
    expect(verified[0]?.afterHan).toBe(4);
    expect(verified[0]?.global_han).toBe(14);
  });

  it('drops unknown left string', () => {
    const { verified, dropped } = verifySegmentInsertions(
      han,
      [{ mark: '。', left: 'wrong', occurrence: 1 }],
      0,
    );
    expect(verified).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('uses occurrence for repeated characters', () => {
    const text = '不不不';
    const { verified, dropped } = verifySegmentInsertions(
      text,
      [{ mark: '，', left: '不', occurrence: 2 }],
      0,
    );
    expect(dropped).toBe(0);
    expect(verified[0]?.afterHan).toBe(1);
  });
});

describe('astral-plane Han in JSON-anchor insertions', () => {
  it('accepts an Extension B character as the anchor', () => {
    const json = JSON.stringify({ insertions: [{ mark: '，', left: '𪁺', occurrence: 1 }] });
    expect(parseValidInsertions(json)).toHaveLength(1);
  });

  it('resolves offsets in code points, so marks after astral characters stay aligned', () => {
    // 祝荼草旋龜𪁺𩿧魚: 𩿧 is the 7th Han, index 6, though it sits at UTF-16 offset 7.
    const { verified, dropped } = verifySegmentInsertions(
      '祝荼草旋龜𪁺𩿧魚',
      [
        { mark: '，', left: '𩿧', occurrence: 1 },
        { mark: '。', left: '魚', occurrence: 1 },
      ],
      100,
    );
    expect(dropped).toBe(0);
    expect(verified.map((v) => [v.afterHan, v.global_han])).toEqual([
      [6, 106],
      [7, 107],
    ]);
  });
});
