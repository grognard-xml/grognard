import {
  emptyTagColorsFile,
  generateTagColorsCss,
  getDefaultTagColor,
  injectTagColorsCss,
  loadAndInjectTagColors,
  getAttributeRuleKeys,
  makeTagRuleKey,
  parseTagRuleKey,
  mixHex,
  pillColorsFromEntry,
  contrastTextOn,
  reapplyCachedTagColors,
  resolveTagColor,
  updateTagColor,
  type TagColorEntry,
} from './tagColors';

describe('tagColors', () => {
  test('generateTagColorsCss emits showTags rules', () => {
    const file = emptyTagColorsFile();
    file.tags.persName = { highlight: '#abcabc', text: '#123123' };
    const css = generateTagColorsCss(file);
    expect(css).toContain("*[_tag='persName']");
    expect(css).toContain("*[_tag='persName'] *");
    expect(css).toContain('background-color: #abcabc');
    expect(css).toContain('color: #123123');
    expect(css).toContain(".showTags *[_tag='persName']:before");
    expect(css).toContain(".showTags *[_tag='persName'] *[_tag]:before");
    expect(css).toContain('background-color: #527163');
    expect(css).toContain('color: #ffffff');
    expect(css).toContain('box-decoration-break: clone');
  });

  test('generateTagColorsCss respects disabled highlight and text toggles', () => {
    const file = emptyTagColorsFile();
    file.tags.persName = {
      highlight: '#abcabc',
      text: '#123123',
      highlightEnabled: false,
      textEnabled: false,
    };
    const css = generateTagColorsCss(file);
    expect(css).not.toContain('background-color: #abcabc');
    expect(css).not.toContain('color: #123123');
  });

  test('rule keys round-trip tag, attribute and value', () => {
    expect(makeTagRuleKey('persName')).toBe('persName');
    expect(makeTagRuleKey('persName', 'type', 'author')).toBe('persName[type=author]');
    expect(parseTagRuleKey('persName')).toEqual({ tagName: 'persName' });
    expect(parseTagRuleKey('persName[type=a=b]')).toEqual({
      tagName: 'persName',
      attrName: 'type',
      attrValue: 'a=b',
    });
  });

  test('generateTagColorsCss emits attribute rules after plain rules', () => {
    const file = emptyTagColorsFile();
    file.tags["persName[type=it's]"] = { highlight: '#111111' };
    file.tags.persName = { highlight: '#abcabc' };
    const css = generateTagColorsCss(file);
    const attrRule =
      "*[_tag='persName'][type='it\\'s'], *[_tag='persName']:where([type='it\\'s']) *";
    expect(css).toContain(attrRule);
    expect(css).toContain(".showTags *[_tag='persName'][type='it\\'s']:before");
    expect(css.indexOf(attrRule)).toBeGreaterThan(css.indexOf('background-color: #abcabc'));
    expect(getAttributeRuleKeys(file, 'persName')).toEqual(["persName[type=it's]"]);
  });

  test('mixHex blends colours toward a target weight', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  test('pillColorsFromEntry darkens highlight and picks contrasting label text', () => {
    expect(pillColorsFromEntry({ highlight: '#fef9e7', text: '#7d6608' })).toEqual({
      background: '#b3a466',
      text: '#000000',
    });
    expect(pillColorsFromEntry({ highlight: '#d5f5e3', text: '#186a3b' })).toEqual({
      background: '#67a482',
      text: '#000000',
    });
    expect(pillColorsFromEntry({ highlight: '#1e8449', text: '#145a32' })).toEqual({
      background: '#186c3c',
      text: '#ffffff',
    });
  });

  test('contrastTextOn picks whichever of black or white reads better', () => {
    expect(contrastTextOn('#ffffff')).toBe('#000000');
    expect(contrastTextOn('#111111')).toBe('#ffffff');
    expect(contrastTextOn('#b3a466')).toBe('#000000');
  });

  test('resolveTagColor falls back to defaults', () => {
    const file = emptyTagColorsFile();
    const resolved = resolveTagColor(file, 'persName');
    expect(resolved).toEqual(getDefaultTagColor('persName'));
  });

  test('updateTagColor removes entry when null', async () => {
    const writeFile = jest.fn().mockResolvedValue(undefined);
    (
      window as unknown as { electronAPI: { writeFile: typeof writeFile; readFile: jest.Mock } }
    ).electronAPI = {
      writeFile,
      readFile: jest.fn().mockRejectedValue(new Error('missing')),
    };

    const updated = await updateTagColor('/proj', 'persName', { highlight: '#fff', text: '#000' });
    expect(updated.tags.persName).toEqual({ highlight: '#fff', text: '#000' });

    const cleared = await updateTagColor('/proj', 'persName', null);
    expect(cleared.tags.persName).toBeUndefined();
  });

  test('updateTagColor preserves other tags under concurrent updates', async () => {
    let stored = '';
    const readFile = jest.fn().mockImplementation(async () => {
      if (!stored) throw new Error('missing');
      return stored;
    });
    const writeFile = jest.fn().mockImplementation(async (path: string, content: string) => {
      // Only store JSON file content, not CSS
      if (path.endsWith('.json')) {
        stored = content;
      }
    });
    (
      window as unknown as {
        electronAPI: { writeFile: typeof writeFile; readFile: typeof readFile };
      }
    ).electronAPI = {
      writeFile,
      readFile,
    };

    await Promise.all([
      updateTagColor('/proj', 'persName', { highlight: '#111111', text: '#222222' }),
      updateTagColor('/proj', 'placeName', { highlight: '#333333', text: '#444444' }),
    ]);

    const file = JSON.parse(stored) as { tags: Record<string, TagColorEntry> };
    expect(file.tags.persName).toEqual({ highlight: '#111111', text: '#222222' });
    expect(file.tags.placeName).toEqual({ highlight: '#333333', text: '#444444' });
  });

  test('loadAndInjectTagColors caches css for later editor injection', async () => {
    const cssText = "*[_tag='persName'] { background-color: #abc; }";
    (
      window as unknown as {
        electronAPI: { readFile: jest.Mock; pathExists: jest.Mock };
      }
    ).electronAPI = {
      readFile: jest
        .fn()
        .mockResolvedValue(
          JSON.stringify({ version: 1, tags: { persName: { highlight: '#abc' } } }),
        ),
      pathExists: jest.fn().mockResolvedValue(true),
    };
    delete (window as unknown as { writer?: unknown }).writer;

    await loadAndInjectTagColors('/proj');
    expect(reapplyCachedTagColors('/proj')).toBe(false);

    const doc = document.implementation.createHTMLDocument('');
    (window as unknown as { writer: { editor: { getDoc: () => Document } } }).writer = {
      editor: { getDoc: () => doc },
    };

    expect(reapplyCachedTagColors('/proj')).toBe(true);
    expect(doc.getElementById('tagColors')?.textContent).toContain("*[_tag='persName']");
    expect(injectTagColorsCss(cssText)).toBe(true);
  });
});
