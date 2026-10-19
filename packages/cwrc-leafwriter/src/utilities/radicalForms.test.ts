import radicalFormsData from '../resources/ids/radicalForms.json';
import kageCore from '../resources/glyphwiki/kageCore.json';
import { effectiveLeafInput } from './composerTree';
import { previewComposerTree } from './projectGlyphStore';
import { emptyProjectGlyphRegistry } from './projectGlyphRegistry';
import { automaticFormFor, formsOf, nextFormOf } from './radicalForms';

const data = radicalFormsData as {
  auto: Record<string, Record<string, string>>;
  families: string[][];
};
const glyph = (char: string) => `u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`;

describe('automaticFormFor', () => {
  it('uses the left-hand form of a radical on the left', () => {
    expect(automaticFormFor('言', '⿰', 0)).toBe('訁');
    expect(automaticFormFor('金', '⿰', 0)).toBe('釒');
    expect(automaticFormFor('人', '⿰', 0)).toBe('亻');
    expect(automaticFormFor('水', '⿰', 0)).toBe('氵');
    expect(automaticFormFor('示', '⿰', 0)).toBe('礻');
  });

  it('uses the top form of a radical on top', () => {
    expect(automaticFormFor('竹', '⿱', 0)).toBe('𥫗');
    expect(automaticFormFor('艸', '⿱', 0)).toBe('艹');
  });

  it('leaves a radical alone where its own shape is right', () => {
    expect(automaticFormFor('言', '⿰', 1)).toBeNull();
    expect(automaticFormFor('言', '⿱', 1)).toBeNull();
    expect(automaticFormFor('木', '⿰', 0)).toBeNull();
  });

  it('keeps 阜 on the left and 邑 on the right', () => {
    expect(automaticFormFor('阜', '⿰', 0)).toBe('阝');
    expect(automaticFormFor('阜', '⿰', 1)).toBeNull();
    expect(automaticFormFor('邑', '⿰', 1)).toBe('阝');
    expect(automaticFormFor('邑', '⿰', 0)).toBeNull();
  });
});

describe('the generated table', () => {
  const rules = Object.entries(data.auto).flatMap(([base, byPosition]) =>
    Object.entries(byPosition).map(([position, form]) => ({ base, position, form })),
  );

  it('has rules', () => {
    expect(rules.length).toBeGreaterThan(25);
  });

  it('only ever draws a form GlyphWiki can draw', () => {
    for (const { base, form } of rules) {
      expect(glyph(base) in kageCore).toBe(true);
      expect(glyph(form) in kageCore).toBe(true);
    }
  });

  it('never replaces a character with a compatibility ideograph', () => {
    for (const { form } of rules) {
      const cp = form.codePointAt(0)!;
      expect(cp >= 0xf900 && cp <= 0xfaff).toBe(false);
      expect(cp >= 0x2f800 && cp <= 0x2fa1f).toBe(false);
    }
  });

  it('never picks a simplified form automatically', () => {
    for (const { form } of rules) {
      expect(['讠', '钅', '饣', '纟', '⻈', '⻐', '⻟', '⺯']).not.toContain(form);
    }
  });

  it('only rewrites a base character, never a form of a radical', () => {
    const bases = new Set(Object.keys(data.auto));
    for (const { form } of rules) expect(bases.has(form)).toBe(false);
  });
});

describe('cycling through the forms', () => {
  it('lists every form of a radical, base first', () => {
    expect(formsOf('言')).toEqual(['言', '訁', '讠', '⻈']);
    expect(formsOf('訁')).toEqual(['言', '訁', '讠', '⻈']);
    expect(formsOf('人')).toEqual(['人', '亻', '⺅', '𠆢']);
    expect(formsOf('木')).toEqual([]);
  });

  it('wraps round and returns null for a character with no other form', () => {
    expect(nextFormOf('言')).toBe('訁');
    expect(nextFormOf('⻈')).toBe('言');
    expect(nextFormOf('木')).toBeNull();
  });

  it('gives 阝 the forms of both radicals it stands for', () => {
    expect(formsOf('阝')).toEqual(expect.arrayContaining(['阜', '邑', '⻖', '⻏']));
  });
});

describe('composing with a position form', () => {
  const registry = emptyProjectGlyphRegistry();
  const leaf = (input: string, exactForm?: boolean) => ({
    kind: 'leaf' as const,
    input,
    exactForm,
  });

  it('draws 言 on the left of 謀 as 訁 but keeps ⿰言某 as the IDS', () => {
    const preview = previewComposerTree('⿰', [leaf('言'), leaf('某')], registry);
    expect(preview.kageData).toContain('u8a01');
    expect(preview.kageData).not.toContain('u8a00');
    expect(preview.ids).toBe('⿰言某');
    expect(preview.existingUnicodeChar).toBe('謀');
    expect(preview.unresolvedComponents).toEqual([]);
  });

  it('draws the exact character when it was chosen', () => {
    const preview = previewComposerTree('⿰', [leaf('言', true), leaf('某')], registry);
    expect(preview.kageData).toContain('u8a00');
    expect(preview.kageData).not.toContain('u8a01');
  });

  it('uses the position inside a nested layout', () => {
    const preview = previewComposerTree(
      '⿰',
      [leaf('木'), { kind: 'nested', operator: '⿱', parts: [leaf('竹'), leaf('日')] }],
      registry,
    );
    expect(preview.ids).toBe('⿰木⿱竹日');
    expect(preview.kageData).toContain('__nested_');
    expect(preview.unresolvedComponents).toEqual([]);
  });

  it('effectiveLeafInput ignores anything that is not a single character', () => {
    expect(effectiveLeafInput(leaf('chhiv-0003'), '⿰', 0)).toBe('chhiv-0003');
    expect(effectiveLeafInput(leaf('言'), '⿰', 0)).toBe('訁');
    expect(effectiveLeafInput(leaf('言', true), '⿰', 0)).toBe('言');
  });
});
