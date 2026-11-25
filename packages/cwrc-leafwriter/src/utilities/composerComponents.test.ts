import {
  buildComponentSections,
  isDifficultComponent,
  leadingStrokeClass,
  toggleComponentInFindText,
} from './composerComponents';

describe('composerComponents', () => {
  it('lists common radicals by stroke count', () => {
    const sections = buildComponentSections({
      showDifficult: false,
      showRadicalVariants: true,
      firstStrokes: [],
    });
    const strokes3 = sections.find((s) => s.strokes === 3);
    expect(strokes3?.components).toEqual(expect.arrayContaining(['口', '扌', '氵']));
    expect(strokes3?.components.some((ch) => isDifficultComponent(ch))).toBe(false);
  });

  it('hides radical variants when asked', () => {
    const withVariants = buildComponentSections({
      showDifficult: false,
      showRadicalVariants: true,
      firstStrokes: [],
    });
    const without = buildComponentSections({
      showDifficult: false,
      showRadicalVariants: false,
      firstStrokes: [],
    });
    const flat = (sections: ReturnType<typeof buildComponentSections>) =>
      sections.flatMap((s) => s.components);
    expect(flat(withVariants)).toEqual(expect.arrayContaining(['扌', '氵', '亻']));
    expect(flat(without)).not.toEqual(expect.arrayContaining(['扌']));
    expect(flat(without)).not.toContain('扌');
    expect(flat(without)).not.toContain('氵');
  });

  it('includes difficult components when enabled', () => {
    const sections = buildComponentSections({
      showDifficult: true,
      showRadicalVariants: true,
      firstStrokes: [],
    });
    const flat = sections.flatMap((s) => s.components);
    expect(flat.some((ch) => isDifficultComponent(ch))).toBe(true);
  });

  it('filters by first-stroke class', () => {
    const sections = buildComponentSections({
      showDifficult: false,
      showRadicalVariants: true,
      firstStrokes: [4],
    });
    const flat = sections.flatMap((s) => s.components);
    expect(flat).toEqual(expect.arrayContaining(['氵', '丶']));
    expect(flat).not.toContain('一');
    expect(leadingStrokeClass('氵')).toBe(4);
    expect(leadingStrokeClass('一')).toBe(1);
  });

  it('toggles a component in the Find field text', () => {
    expect(toggleComponentInFindText('', '木')).toBe('木');
    expect(toggleComponentInFindText('木', '言')).toBe('木 言');
    expect(toggleComponentInFindText('木 言', '木')).toBe('言');
    expect(toggleComponentInFindText('木16', '言')).toBe('木16 言');
  });
});
