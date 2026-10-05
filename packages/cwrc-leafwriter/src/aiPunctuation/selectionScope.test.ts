import {
  filterSegmentsForAi,
  filterSegmentsForAiGaps,
  chunkHanText,
  findSelectionHanRange,
  clipSegmentToHanRange,
  buildJuanHanTape,
  selectionHanOnly,
  segmentNeedsAiGap,
  punctPer100Han,
  extractJuanDiv,
  replaceJuanDiv,
  clipTextToHanRange,
  punctInHanRange,
  unpunctuatedRanges,
  cpLength,
} from './selectionScope';

describe('chunkHanText', () => {
  it('returns one chunk for short text', () => {
    expect(chunkHanText('甲乙丙')).toEqual([{ text: '甲乙丙', offset: 0 }]);
  });

  it('splits long text with overlap', () => {
    const han = '甲'.repeat(600);
    const chunks = chunkHanText(han, 500, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.offset).toBe(0);
  });
});

describe('filterSegmentsForAi', () => {
  const segments = [
    { id: 0, han: '甲'.repeat(25), has_punct: false },
    { id: 1, han: '乙'.repeat(25), has_punct: true },
    { id: 2, han: '丙', has_punct: false },
  ];

  it('skips punctuated and short segments', () => {
    const out = filterSegmentsForAi(segments);
    expect(out.map((s) => s.id)).toEqual([0]);
  });

  it('filters by segment id scope', () => {
    const out = filterSegmentsForAi(segments, [0, 2]);
    expect(out.map((s) => s.id)).toEqual([0]);
  });
});

describe('filterSegmentsForAiGaps', () => {
  const segments = [
    { id: 0, han: '甲'.repeat(25), has_punct: false },
    { id: 1, han: `${'乙'.repeat(200)}。`, has_punct: true },
    { id: 2, han: `${'丙'.repeat(200)}${'。'.repeat(3)}`, has_punct: true },
    { id: 3, han: '丁', has_punct: false },
  ];

  it('includes unpunctuated segments and sparse parallel coverage', () => {
    const out = filterSegmentsForAiGaps(segments);
    expect(out.map((s) => s.id)).toEqual([0, 1]);
  });

  it('skips segments above punct-density threshold', () => {
    expect(punctPer100Han(segments[2].han)).toBeGreaterThan(0.75);
    expect(segmentNeedsAiGap(segments[2])).toBe(false);
  });

  it('counts density from `text`, not just `han` (han never carries punctuation for real segments)', () => {
    // Regression test: in production, `han` is Han-only by construction
    // (Python's _atoms_han strips everything else), so a real segment's
    // `han` alone can never show density -- the punctuated `text` field
    // must be what's counted, or every long segment always reads as
    // needing more punctuation regardless of how well it's actually done.
    const han = '丙'.repeat(200);
    const text = `${'丙、'.repeat(200)}。`;
    expect(punctPer100Han(han)).toBe(0);
    expect(punctPer100Han(han, text)).toBeGreaterThan(0.75);
    expect(segmentNeedsAiGap({ han, has_punct: true, text })).toBe(false);
  });
});

describe('findSelectionHanRange', () => {
  const segments = [
    { id: 0, han: '甲乙丙丁', han_start: 0, han_end: 4, has_punct: false },
    { id: 1, han: '戊己庚辛', han_start: 4, han_end: 8, has_punct: false },
  ];

  it('returns undefined when nothing selected', () => {
    expect(findSelectionHanRange(segments, '')).toBeUndefined();
  });

  it('locates a substring within one segment', () => {
    expect(findSelectionHanRange(segments, '乙丙')).toEqual({ start: 1, end: 3 });
  });

  it('clips a segment to the selection range', () => {
    const range = findSelectionHanRange(segments, '乙丙');
    expect(range).toEqual({ start: 1, end: 3 });
    if (!range) throw new Error('expected range');
    const clipped = clipSegmentToHanRange(segments[0], range);
    expect(clipped?.han).toBe('乙丙');
    expect(clipped?.han_start).toBe(1);
    expect(clipped?.han_end).toBe(3);
  });

  it('builds a contiguous han tape', () => {
    expect(buildJuanHanTape(segments)).toBe('甲乙丙丁戊己庚辛');
  });

  it('strips non-Han from selection', () => {
    expect(selectionHanOnly('甲，乙。丙')).toBe('甲乙丙');
  });
});

describe('extractJuanDiv / replaceJuanDiv with nested divs', () => {
  const xml =
    '<body><div type="juan"><p>a</p><div><head>H</head><p>b</p></div><p>c</p></div></body>';

  it('returns the whole juan div, not just up to the first inner </div>', () => {
    expect(extractJuanDiv(xml)).toBe(
      '<div type="juan"><p>a</p><div><head>H</head><p>b</p></div><p>c</p></div>',
    );
  });

  it('replaces the whole juan div', () => {
    expect(replaceJuanDiv(xml, '<div type="juan">X</div>')).toBe(
      '<body><div type="juan">X</div></body>',
    );
  });

  it('spans consecutive sibling juan divs (a file with several headings)', () => {
    const multi =
      '<body>\n<div type="juan"><p>a</p></div>\n<div type="juan"><head>H</head><p>b</p></div>\n</body>';
    expect(extractJuanDiv(multi)).toBe(
      '<div type="juan"><p>a</p></div>\n<div type="juan"><head>H</head><p>b</p></div>',
    );
    expect(replaceJuanDiv(multi, '<div type="juan">X</div>')).toBe(
      '<body>\n<div type="juan">X</div>\n</body>',
    );
  });
});

describe('existing punctuation in a selection', () => {
  // One segment (adjacent paragraphs share a segment): 2 punctuated paragraph + 1 bare one.
  const seg = {
    han: '甲乙丙丁戊己庚辛壬癸',
    text: '甲乙，丙丁。戊己庚辛壬癸',
    han_start: 0,
    han_end: 10,
  };

  it('clipTextToHanRange keeps marks that follow selected characters', () => {
    expect(clipTextToHanRange(seg, { start: 0, end: 4 })).toBe('甲乙，丙丁。');
    expect(clipTextToHanRange(seg, { start: 4, end: 10 })).toBe('戊己庚辛壬癸');
    expect(clipTextToHanRange(seg, { start: 2, end: 3 })).toBe('丙');
  });

  it('punctInHanRange sees marks in `text` (han never holds any) and respects the range', () => {
    expect(punctInHanRange([seg], { start: 0, end: 10 })).toBe(true);
    expect(punctInHanRange([seg], { start: 0, end: 4 })).toBe(true);
    expect(punctInHanRange([seg], { start: 4, end: 10 })).toBe(false);
    expect(
      punctInHanRange([{ ...seg, text: undefined as unknown as string }], { start: 0, end: 10 }),
    ).toBe(false);
  });
});

describe('unpunctuatedRanges', () => {
  const p = (start: number, end: number, marks: number) => ({
    han_start: start,
    han_end: end,
    han_count: end - start,
    punct_count: marks,
  });

  it('selecting a punctuated and a bare paragraph yields only the bare one', () => {
    expect(unpunctuatedRanges([p(0, 40, 6), p(40, 80, 0)], { start: 0, end: 80 })).toEqual([
      { start: 40, end: 80 },
    ]);
  });

  it('returns nothing when everything in range is punctuated', () => {
    expect(unpunctuatedRanges([p(0, 40, 6), p(40, 80, 5)], { start: 0, end: 80 })).toEqual([]);
  });

  it('merges touching bare paragraphs and keeps separated runs apart', () => {
    const paragraphs = [p(0, 40, 0), p(40, 80, 0), p(80, 120, 6), p(120, 160, 0)];
    expect(unpunctuatedRanges(paragraphs, { start: 0, end: 160 })).toEqual([
      { start: 0, end: 80 },
      { start: 120, end: 160 },
    ]);
  });

  it('clips a partly selected paragraph to the selection', () => {
    expect(unpunctuatedRanges([p(0, 100, 0)], { start: 30, end: 60 })).toEqual([
      { start: 30, end: 60 },
    ]);
  });

  it('treats a sparsely punctuated paragraph as bare (same threshold as fill-gaps)', () => {
    expect(unpunctuatedRanges([p(0, 400, 1)], { start: 0, end: 400 })).toEqual([
      { start: 0, end: 400 },
    ]);
  });
});

describe('astral-plane Han (Extension B and later)', () => {
  const han = '祝荼草旋龜𪁺𩿧魚'; // 8 Han: 𪁺 U+2A07A and 𩿧 U+29FE7 are outside the BMP

  it('counts one Han index per character, not per UTF-16 unit', () => {
    expect(han.length).toBe(10);
    expect(cpLength(han)).toBe(8);
    expect(cpLength(selectionHanOnly(`${han}，。`))).toBe(8);
    expect(selectionHanOnly('甲𪁺，乙')).toBe('甲𪁺乙');
  });

  it('rebuilds the tape and locates a selection after astral characters in code points', () => {
    const segments = [
      { han, han_start: 0, han_end: 8 },
      { han: '戊己庚辛壬癸', han_start: 8, han_end: 14 },
    ];
    expect(buildJuanHanTape(segments)).toBe(`${han}戊己庚辛壬癸`);
    expect(findSelectionHanRange(segments, '戊己庚辛壬癸')).toEqual({ start: 8, end: 14 });
    expect(findSelectionHanRange(segments, '旋龜𪁺𩿧魚')).toEqual({ start: 3, end: 8 });
  });

  it('clips a segment by code points without splitting a surrogate pair', () => {
    const clipped = clipSegmentToHanRange({ han, han_start: 0, han_end: 8 }, { start: 4, end: 7 });
    expect(clipped?.han).toBe('龜𪁺𩿧');
    expect(clipped).toMatchObject({ han_start: 4, han_end: 7 });
  });

  it('chunks without splitting a pair and counts offsets in code points', () => {
    const chunks = chunkHanText(han, 5, 0);
    expect(chunks.map((c) => c.text)).toEqual(['祝荼草旋龜', '𪁺𩿧魚']);
    expect(chunks.map((c) => c.offset)).toEqual([0, 5]);
  });

  it('reads punctuation in the clipped text of a range after astral characters', () => {
    const seg = { han: '甲𪁺丙丁', text: '甲𪁺，丙丁。', han_start: 0, han_end: 4 };
    expect(clipTextToHanRange(seg, { start: 2, end: 4 })).toBe('丙丁。');
    expect(punctInHanRange([seg], { start: 2, end: 4 })).toBe(true);
    expect(punctInHanRange([seg], { start: 0, end: 1 })).toBe(false);
  });
});
