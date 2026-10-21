import {
  BUILTIN_GAIJI_EQUIVALENTS,
  effectiveGaijiOverrides,
  isValidGaijiCharacter,
  parseGaijiOverrides,
  replaceKanripoGaijiWithCharacter,
  serializeGaijiOverrides,
} from './gaijiOverrides';

describe('isValidGaijiCharacter', () => {
  it('accepts one code point (including astral) or a bracketed IDS, rejects the rest', () => {
    expect(isValidGaijiCharacter('𪁺')).toBe(true);
    expect(isValidGaijiCharacter(' 字 ')).toBe(true);
    expect(isValidGaijiCharacter('[⿰魚甬]')).toBe(true);
    expect(isValidGaijiCharacter('兩字')).toBe(false);
    expect(isValidGaijiCharacter('<g/>')).toBe(false);
    expect(isValidGaijiCharacter('')).toBe(false);
  });
});

describe('parseGaijiOverrides / serializeGaijiOverrides', () => {
  it('keeps only well-formed entries and round-trips sorted', () => {
    const parsed = parseGaijiOverrides(
      JSON.stringify({ KR2113: '𩿧', KR2112: '𪁺', KR21: 'x', KR2114: '兩字' }),
    );
    expect(parsed).toEqual({ KR2112: '𪁺', KR2113: '𩿧' });
    expect(Object.keys(parseGaijiOverrides(serializeGaijiOverrides(parsed)))).toEqual([
      'KR2112',
      'KR2113',
    ]);
  });

  it('returns an empty table for invalid JSON or non-objects', () => {
    expect(parseGaijiOverrides('not json')).toEqual({});
    expect(parseGaijiOverrides('[1,2]')).toEqual({});
  });
});

describe('replaceKanripoGaijiWithCharacter', () => {
  it('replaces every matching gaiji with text and leaves others alone', () => {
    document.body.innerHTML =
      '<span _tag="p">旋龜<span _tag="g" type="kanripo" n="KR2112"><span _tag="graphic"></span></span>魚' +
      '<span _tag="g" type="kanripo" n="KR2112"></span>' +
      '<span _tag="g" type="kanripo" n="KR9999"></span></span>';
    const count = replaceKanripoGaijiWithCharacter(document.body, 'KR2112', '𪁺');
    expect(count).toBe(2);
    expect(document.body.textContent).toBe('旋龜𪁺魚𪁺');
    expect(document.querySelectorAll('[n="KR9999"]')).toHaveLength(1);
  });
});

describe('effectiveGaijiOverrides', () => {
  it('ships the built-in equivalents, lets the project override them, and resolves IDS', () => {
    expect(Object.keys(BUILTIN_GAIJI_EQUIVALENTS).length).toBeGreaterThan(50);
    const [id] = Object.keys(BUILTIN_GAIJI_EQUIVALENTS);
    expect(effectiveGaijiOverrides({})[id]).toBe(BUILTIN_GAIJI_EQUIVALENTS[id]);
    expect(effectiveGaijiOverrides({ [id]: '字' })[id]).toBe('字');
    expect(effectiveGaijiOverrides({ KR9999: '[⿰言某]' }).KR9999).toBe('謀');
    expect(effectiveGaijiOverrides({ KR9998: '[⿰言言言言]' }).KR9998).toBe('[⿰言言言言]');
  });
});
