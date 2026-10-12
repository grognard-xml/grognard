import fs from 'fs';
import path from 'path';
import { collectTextNodes, createAnchor, createCompoundAnchor } from './anchor';
import { applySuggestions, applyWithWrapperCandidates, revertToSnapshot } from './apply';
import { anchorForDateElement, findTeiBodyRoot } from './dates';
import { normalizeDomText } from './normalize';
import { groupWrapperCandidateSuggestions } from './wrapperCandidates';
import type { Suggestion } from './types';

const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  normalizeDomText(doc);
  return doc;
};

const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);

const TEI = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>
<p>上陽子曰：老君出真文於大浮黎土。</p>
<p>又見上陽子，居<placeName>洛陽</placeName>之南。</p>
</body></text></TEI>`;

/** Build an 'add' suggestion for the nth occurrence of a string in the document. */
const suggest = (
  doc: Document,
  surface: string,
  tag: string,
  n = 1,
  extra: Partial<Suggestion> = {},
): Suggestion => {
  const nodes = collectTextNodes(doc, 'ignore');
  let seen = 0;
  for (const { node, search } of nodes) {
    let from = 0;
    while (true) {
      const idx = search.text.indexOf(surface, from);
      if (idx === -1) break;
      if (++seen === n) {
        const rawStart = search.map[idx]!;
        const rawEnd = search.map[idx + surface.length - 1]! + 1;
        return {
          id: `sug_${surface}_${n}`,
          source: 'dictionary',
          action: 'add',
          tag,
          anchor: createAnchor('doc', doc, node, rawStart, rawEnd, 'ignore'),
          status: 'pending',
          ...extra,
        };
      }
      from = idx + 1;
    }
  }
  throw new Error(`occurrence ${n} of ${surface} not found`);
};

describe('applySuggestions', () => {
  it('removes nested same-type tags before returning the validation result', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><persName>張<persName>行成</persName></persName></p></body></text></TEI>',
    );

    await applySuggestions(doc, [], { policy: 'ignore' });

    expect(doc.getElementsByTagName('persName')).toHaveLength(1);
    expect(doc.getElementsByTagName('persName')[0]!.textContent).toBe('張行成');
  });

  it('wraps existing tagged components without replacing their structure', async () => {
    const doc = parse(
      `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><roleName>合州刺史</roleName><nobleTitle><placeName>鄱陽</placeName><roleName>王</roleName></nobleTitle><persName>範</persName></p></body></text></TEI>`,
    );
    const start = doc.getElementsByTagName('roleName')[0]!.firstChild as Text;
    const end = doc.getElementsByTagName('persName')[0]!.firstChild as Text;
    const anchor = createCompoundAnchor(
      'doc',
      doc,
      start,
      0,
      end,
      end.data.length,
      '合州刺史鄱陽王範',
      'ignore',
    );
    const suggestion: Suggestion = {
      id: 'compound',
      source: 'authority',
      action: 'add-compound',
      tag: 'name',
      attributes: { type: 'personWrapper', cert: 'unknown' },
      anchor,
      status: 'pending',
    };
    const { applied } = await applySuggestions(doc, [suggestion], { policy: 'ignore' });
    expect(applied).toBe(1);
    const wrapper = doc.getElementsByTagName('name')[0]!;
    expect(wrapper.getAttribute('type')).toBe('personWrapper');
    expect(wrapper.getElementsByTagName('roleName')).toHaveLength(2);
    expect(wrapper.getElementsByTagName('placeName')[0]!.textContent).toBe('鄱陽');
    expect(wrapper.getElementsByTagName('persName')[0]!.textContent).toBe('範');
  });

  it('snaps a compound anchor end past collapsed whitespace, but keeps a node-end boundary exact', () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><roleName>王</roleName><persName>範  之</persName></p></body></text></TEI>',
    );
    const start = doc.getElementsByTagName('roleName')[0]!.firstChild as Text;
    const end = doc.getElementsByTagName('persName')[0]!.firstChild as Text;
    // Raw end 2 is inside the run of two spaces: snaps back to just after 範.
    const mid = createCompoundAnchor('doc', doc, start, 0, end, 2, '王範', 'collapse');
    expect(mid.endOffset).toBe(2);
    const midFirst = createCompoundAnchor('doc', doc, start, 0, end, 1, '王範', 'collapse');
    expect(midFirst.endOffset).toBe(1);
    const full = createCompoundAnchor(
      'doc',
      doc,
      start,
      0,
      end,
      end.data.length,
      '王範 之',
      'collapse',
    );
    expect(full.endOffset).toBe(end.data.length);
  });

  it('does not nest a nobleTitle roleName inside a pre-existing roleName ancestor', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><roleName>太尉</roleName></p></body></text></TEI>',
    );
    const suggestion: Suggestion = {
      id: 'nobletitle_in_rolename',
      source: 'authority',
      action: 'add',
      tag: 'nobleTitle',
      innerXml: '<roleName>太尉</roleName>',
      anchor: createAnchor(
        'doc',
        doc,
        doc.getElementsByTagName('roleName')[0]!.firstChild as Text,
        0,
        2,
        'ignore',
      ),
      status: 'pending',
    };
    const { applied } = await applySuggestions(doc, [suggestion], { policy: 'ignore' });
    expect(applied).toBe(1);
    // Only the original roleName survives — the compound's own roleName was
    // stripped rather than nested inside it.
    expect(doc.getElementsByTagName('roleName')).toHaveLength(1);
    expect(doc.getElementsByTagName('nobleTitle')[0]!.textContent).toBe('太尉');
  });

  it('refuses a compound suggestion whose innerXml text does not match the matched surface — never rewrites source text', async () => {
    // Reproduces a real bug: one authority record shares its metadata across
    // both a "bare" (fief+rank, e.g. 明帝) and a "full" (fief+posthumousName+
    // rank) search-string form. Applying the full form's components onto a
    // span that only matched the bare form spliced a posthumous name into
    // the document that was never in the source text.
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p>明帝遣使</p></body></text></TEI>',
    );
    const before = serialize(doc);
    const suggestion: Suggestion = {
      id: 'noble_title_mismatch',
      source: 'authority',
      action: 'add',
      tag: 'nobleTitle',
      innerXml:
        '<placeName>明</placeName><persName type="posthumous">欽天履道英毅</persName><roleName>帝</roleName>',
      anchor: createAnchor(
        'doc',
        doc,
        doc.getElementsByTagName('p')[0]!.firstChild as Text,
        0,
        2, // matched span is "明帝" — 2 characters, not the 8 the innerXml would add
        'ignore',
      ),
      status: 'pending',
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { results, applied, textIntegrityWarning } = await applySuggestions(doc, [suggestion], {
      policy: 'ignore',
    });

    expect(applied).toBe(0);
    expect(results[0]!.outcome).toBe('conflict');
    expect(serialize(doc)).toBe(before); // document is byte-for-byte untouched
    expect(textIntegrityWarning).toBeUndefined(); // nothing was applied, so no length change either
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Refused a compound suggestion'),
      expect.objectContaining({ matchedSurface: '明帝' }),
    );
    errorSpy.mockRestore();
  });

  it('applies a compound suggestion normally when innerXml text matches the matched surface exactly', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p>明帝遣使</p></body></text></TEI>',
    );
    const suggestion: Suggestion = {
      id: 'noble_title_bare',
      source: 'authority',
      action: 'add',
      tag: 'nobleTitle',
      innerXml: '<placeName>明</placeName><roleName>帝</roleName>',
      anchor: createAnchor(
        'doc',
        doc,
        doc.getElementsByTagName('p')[0]!.firstChild as Text,
        0,
        2,
        'ignore',
      ),
      status: 'pending',
    };
    const { results, applied, textIntegrityWarning } = await applySuggestions(doc, [suggestion], {
      policy: 'ignore',
    });
    expect(applied).toBe(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(doc.getElementsByTagName('nobleTitle')[0]!.textContent).toBe('明帝');
    expect(textIntegrityWarning).toBeUndefined();
  });

  it('does not nest a title inside an existing persName/placeName/roleName', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><persName>史記</persName></p></body></text></TEI>',
    );
    const suggestion: Suggestion = {
      id: 'title_in_persname',
      source: 'dictionary',
      action: 'add',
      tag: 'title',
      anchor: createAnchor(
        'doc',
        doc,
        doc.getElementsByTagName('persName')[0]!.firstChild as Text,
        0,
        2,
        'ignore',
      ),
      status: 'pending',
    };
    const { results, applied } = await applySuggestions(doc, [suggestion], { policy: 'ignore' });
    expect(applied).toBe(0);
    expect(results[0]!.outcome).toBe('already-tagged');
    expect(doc.getElementsByTagName('title')).toHaveLength(0);
  });

  it('strips a persName sanmiao emits inside <ruler> rather than inserting it', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><date cert="low">魏文帝</date></p></body></text></TEI>',
    );
    const dateEl = doc.getElementsByTagName('date')[0] as Element;
    const anchor = anchorForDateElement(dateEl, findTeiBodyRoot(doc), 'ignore');
    const suggestion: Suggestion = {
      id: 'date_resolve_ruler_persname',
      source: 'dates',
      sourceDetail: 'sanmiao-resolve',
      action: 'resolve-date',
      tag: 'date',
      anchor: anchor!,
      status: 'pending',
      attributes: { resp: '#grognard-sanmiao', cert: 'high' },
      dateResolution: {
        status: 'unique',
        displaySurface: '魏文帝',
        candidates: [{ displayLine: 'test', attrs: {} }],
        parseXml: '<ruler>文<persName>帝</persName></ruler>',
      },
    };
    const { applied } = await applySuggestions(doc, [suggestion], { policy: 'ignore' });
    expect(applied).toBe(1);
    expect(dateEl.getElementsByTagName('persName')).toHaveLength(0);
    expect(dateEl.getElementsByTagName('ruler')[0]!.textContent).toBe('文帝');
  });

  it('wraps the anchored range in a new element in the document namespace', async () => {
    const doc = parse(TEI);
    const batch = [suggest(doc, '上陽子', 'persName')];
    const { results, applied } = await applySuggestions(doc, batch, { policy: 'ignore' });

    expect(applied).toBe(1);
    const el = results[0]!.element!;
    expect(el.nodeName).toBe('persName');
    expect(el.namespaceURI).toBe('http://www.tei-c.org/ns/1.0');
    expect(el.textContent).toBe('上陽子');
    expect(serialize(doc)).toContain('<persName>上陽子</persName>曰');
    expect(batch[0]!.status).toBe('accepted');
  });

  it('sets attributes and applies multiple suggestions in the same text node', async () => {
    const doc = parse(TEI);
    const batch = [
      suggest(doc, '上陽子', 'persName', 1, { attributes: { key: 'p001' } }),
      suggest(doc, '老君', 'persName'),
      suggest(doc, '大浮黎土', 'placeName'),
    ];
    const { applied } = await applySuggestions(doc, batch, { policy: 'ignore' });

    expect(applied).toBe(3);
    const xml = serialize(doc);
    expect(xml).toContain('<persName key="p001">上陽子</persName>');
    expect(xml).toContain('<persName>老君</persName>');
    expect(xml).toContain('<placeName>大浮黎土</placeName>');
  });

  it('prefers the longer span when suggestions overlap', async () => {
    const doc = parse(TEI);
    const batch = [suggest(doc, '浮黎', 'placeName'), suggest(doc, '大浮黎土', 'placeName')];
    const { results } = await applySuggestions(doc, batch, { policy: 'ignore' });

    const byId = (id: string) => results.find((r) => r.suggestion.id === id)!;
    expect(byId('sug_大浮黎土_1').outcome).toBe('applied');
    // the shorter overlapping span now sits inside the new placeName → dedup catches it
    expect(byId('sug_浮黎_1').outcome).toBe('already-tagged');
    expect(serialize(doc)).not.toContain('<placeName>浮黎</placeName>');
  });

  it('skips text already wrapped in the same tag', async () => {
    const doc = parse(TEI);
    const { results } = await applySuggestions(doc, [suggest(doc, '洛陽', 'placeName')], {
      policy: 'ignore',
    });
    expect(results[0]!.outcome).toBe('already-tagged');
  });

  it('applies only one of two same-span adds with different tags (alternatives)', async () => {
    const doc = parse(TEI);
    const batch = [
      suggest(doc, '上陽子', 'persName', 1, { id: 'alt_pers' }),
      suggest(doc, '上陽子', 'title', 1, { id: 'alt_title' }),
    ];
    const { results, applied } = await applySuggestions(doc, batch, { policy: 'ignore' });

    expect(applied).toBe(1);
    const byId = (id: string) => results.find((r) => r.suggestion.id === id)!;
    expect(byId('alt_pers').outcome).toBe('applied');
    expect(byId('alt_title').outcome).toBe('conflict');
    const xml = serialize(doc);
    expect(xml).toContain('<persName>上陽子</persName>');
    expect(xml).not.toContain('<title>');
  });

  it('blocks insertions the schema forbids', async () => {
    const doc = parse(TEI);
    const { results } = await applySuggestions(doc, [suggest(doc, '上陽子', 'persName')], {
      policy: 'ignore',
      canContain: (parent, child) => !(parent === 'p' && child === 'persName'),
    });
    expect(results[0]!.outcome).toBe('schema-blocked');
    expect(serialize(doc)).not.toContain('<persName>');
  });

  it('blocks insertions matching a user rule', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><p><placeName>洛陽之南</placeName></p></TEI>',
    );
    const { results } = await applySuggestions(doc, [suggest(doc, '南', 'date')], {
      policy: 'ignore',
      userRules: [{ tag: 'date', notInside: 'placeName' }],
    });
    expect(results[0]!.outcome).toBe('rule-blocked');
  });

  it('blocks entity tags inside <date>', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><date>義熙元年洛陽</date></p></body></text></TEI>',
    );
    const { results } = await applySuggestions(doc, [suggest(doc, '洛陽', 'placeName')], {
      policy: 'ignore',
    });
    expect(results[0]!.outcome).toBe('rule-blocked');
    expect(serialize(doc)).not.toContain('<placeName>');
  });

  it('marks suggestions whose anchor no longer resolves as unresolvable', async () => {
    const doc = parse(TEI);
    const batch = [suggest(doc, '老君', 'persName')];
    // the text changes out from under the suggestion
    const node = collectTextNodes(doc, 'ignore')[0]!.node;
    node.data = node.data.replace('老君', '老子');

    const { results } = await applySuggestions(doc, batch, { policy: 'ignore' });
    expect(results[0]!.outcome).toBe('unresolvable');
    expect(batch[0]!.status).toBe('unresolvable');
  });

  it('reverts the whole batch via the snapshot', async () => {
    const doc = parse(TEI);
    const before = serialize(doc);
    const { snapshot, applied } = await applySuggestions(
      doc,
      [suggest(doc, '上陽子', 'persName'), suggest(doc, '大浮黎土', 'placeName')],
      { policy: 'ignore' },
    );
    expect(applied).toBe(2);
    expect(serialize(doc)).not.toBe(before);
    expect(serialize(revertToSnapshot(snapshot))).toBe(before);
  });

  it('removes an existing tag wrapper (audit remove)', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><persName>張衡</persName>是天文學家</p></body></text></TEI>',
    );
    const batch: Suggestion[] = [
      {
        ...suggest(doc, '張衡', 'persName'),
        action: 'remove',
        source: 'ai',
      },
    ];
    const { results, applied } = await applySuggestions(doc, batch, { policy: 'ignore' });
    expect(applied).toBe(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(serialize(doc)).toContain('張衡是天文學家');
    expect(serialize(doc)).not.toContain('<persName>');
  });

  it('retags an existing mention (audit retag)', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><persName>洛陽</persName></p></body></text></TEI>',
    );
    const batch: Suggestion[] = [
      {
        ...suggest(doc, '洛陽', 'placeName'),
        action: 'retag',
        source: 'ai',
      },
    ];
    const { results, applied } = await applySuggestions(doc, batch, { policy: 'ignore' });
    expect(applied).toBe(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(serialize(doc)).toContain('<placeName>洛陽</placeName>');
    expect(serialize(doc)).not.toContain('<persName>');
  });

  it('redraws a tag boundary (audit redraw-boundary)', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><persName>張衡與</persName>友人</p></body></text></TEI>',
    );
    const batch: Suggestion[] = [
      {
        ...suggest(doc, '張衡', 'persName'),
        action: 'redraw-boundary',
        source: 'ai',
      },
    ];
    const { results, applied } = await applySuggestions(doc, batch, { policy: 'ignore' });
    expect(applied).toBe(1);
    expect(results[0]!.outcome).toBe('applied');
    const xml = serialize(doc);
    expect(xml).toContain('<persName>張衡</persName>與');
    expect(xml).not.toContain('<persName>張衡與</persName>');
  });

  it('processes audit actions before adds in the same batch', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><persName>假人</persName>與張衡</p></body></text></TEI>',
    );
    const batch: Suggestion[] = [
      suggest(doc, '張衡', 'persName'),
      { ...suggest(doc, '假人', 'persName'), action: 'remove', source: 'ai' },
    ];
    const { results, applied } = await applySuggestions(doc, batch, { policy: 'ignore' });
    expect(applied).toBe(2);
    const xml = serialize(doc);
    expect(xml).not.toMatch(/<persName>假人<\/persName>/);
    expect(xml).toContain('<persName>張衡</persName>');
    expect(results.filter((r) => r.outcome === 'applied')).toHaveLength(2);
  });

  it('applies resolve-date when displaySurface spans child elements but anchor is first child', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><date cert="low"><dyn>魏</dyn><era>文帝黃初</era><year>二年</year></date></p></body></text></TEI>',
    );
    const dateEl = doc.getElementsByTagName('date')[0] as Element;
    const anchor = anchorForDateElement(dateEl, findTeiBodyRoot(doc), 'ignore');
    expect(anchor?.surface).toBe('魏');

    const suggestion: Suggestion = {
      id: 'date_resolve_0',
      source: 'dates',
      sourceDetail: 'sanmiao-resolve',
      action: 'resolve-date',
      tag: 'date',
      anchor: anchor!,
      status: 'pending',
      attributes: { resp: '#grognard-sanmiao', cert: 'high', when: '221-08-05' },
      dateResolution: {
        status: 'unique',
        displaySurface: '魏文帝黃初二年',
        candidates: [{ displayLine: 'test', attrs: { when: '221-08-05' } }],
      },
    };

    const { results, applied } = await applySuggestions(doc, [suggestion], { policy: 'ignore' });
    expect(applied).toBe(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(dateEl.getAttribute('when')).toBe('0221-08-05');
  });

  it('drops non-standard TEI date attributes before applying resolve-date', async () => {
    const doc = parse(
      '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p><date cert="low"><dyn>魏</dyn><era>文帝黃初</era><year>二年</year></date></p></body></text></TEI>',
    );
    const dateEl = doc.getElementsByTagName('date')[0] as Element;
    const anchor = anchorForDateElement(dateEl, findTeiBodyRoot(doc), 'ignore');

    const suggestion: Suggestion = {
      id: 'date_resolve_1',
      source: 'dates',
      sourceDetail: 'sanmiao-resolve',
      action: 'resolve-date',
      tag: 'date',
      anchor: anchor!,
      status: 'pending',
      attributes: {
        resp: '#grognard-sanmiao',
        cert: 'high',
        when: '<era xmlns="http://www.tei-c.org/ns/1.0">永元</era><year xmlns="http://www.tei-c.org/ns/1.0">',
      },
      dateResolution: {
        status: 'unique',
        displaySurface: '魏文帝黃初二年',
        candidates: [
          {
            displayLine: 'test',
            attrs: {
              when: '<era xmlns="http://www.tei-c.org/ns/1.0">永元</era><year xmlns="http://www.tei-c.org/ns/1.0">',
            },
          },
        ],
      },
    };

    const { results, applied } = await applySuggestions(doc, [suggestion], { policy: 'ignore' });
    expect(applied).toBe(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(dateEl.hasAttribute('when')).toBe(false);
    expect(dateEl.getAttribute('resp')).toBe('#grognard-sanmiao');
    expect(dateEl.getAttribute('cert')).toBe('high');
  });
});

describe('real corpus batch', () => {
  const xmlPath = path.resolve(__dirname, '../../../../test_project/sizhu_shang.xml');
  const maybe = fs.existsSync(xmlPath) ? it : it.skip;

  maybe('tags every untagged 老君, respects tagged 上陽子, and reverts cleanly', async () => {
    const doc = parse(fs.readFileSync(xmlPath, 'utf-8'));
    const before = serialize(doc);

    // one suggestion per document-wide occurrence of each name
    const batch: Suggestion[] = [];
    for (const surface of ['上陽子', '老君']) {
      const total = collectTextNodes(doc, 'ignore').reduce((count, { search }) => {
        let from = 0;
        while ((from = search.text.indexOf(surface, from) + 1) > 0) count++;
        return count;
      }, 0);
      for (let n = 1; n <= total; n++) batch.push(suggest(doc, surface, 'persName', n));
    }
    expect(batch.length).toBeGreaterThan(5);

    const { results, applied, snapshot } = await applySuggestions(doc, batch, { policy: 'ignore' });
    const already = results.filter((r) => r.outcome === 'already-tagged').length;
    expect(applied + already).toBe(batch.length); // nothing unresolvable or blocked
    expect(applied).toBeGreaterThan(0); // untagged occurrences exist and got tagged
    expect(already).toBeGreaterThan(0); // existing <persName>上陽子</persName> respected

    expect(serialize(revertToSnapshot(snapshot))).toBe(before);
  });
});

describe('applyWithWrapperCandidates', () => {
  const wrapperDoc = () =>
    parse(
      `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p>刺史範為政。</p></body></text></TEI>`,
    );

  it('applies a wrapper candidate atomically: components first, then the wrap', async () => {
    const doc = wrapperDoc();
    const roleName = suggest(doc, '刺史', 'roleName');
    const persName = suggest(doc, '範', 'persName');
    const { groups } = groupWrapperCandidateSuggestions([roleName, persName]);
    expect(groups).toHaveLength(1);

    const { applied, results } = await applyWithWrapperCandidates(doc, [groups[0]!.suggestion], {
      policy: 'ignore',
    });

    // Components + the wrap = 3 applied outcomes for one accepted suggestion.
    expect(applied).toBe(3);
    expect(results.every((r) => r.outcome === 'applied')).toBe(true);
    const wrapper = doc.getElementsByTagName('name')[0]!;
    expect(wrapper.getAttribute('type')).toBe('personWrapper');
    expect(wrapper.getElementsByTagName('roleName')[0]!.textContent).toBe('刺史');
    expect(wrapper.getElementsByTagName('persName')[0]!.textContent).toBe('範');
  });

  it('produces one atomic snapshot — reverting undoes both passes at once', async () => {
    const doc = wrapperDoc();
    const before = serialize(doc);
    const roleName = suggest(doc, '刺史', 'roleName');
    const persName = suggest(doc, '範', 'persName');
    const { groups } = groupWrapperCandidateSuggestions([roleName, persName]);

    const { snapshot } = await applyWithWrapperCandidates(doc, [groups[0]!.suggestion], {
      policy: 'ignore',
    });

    expect(serialize(revertToSnapshot(snapshot))).toBe(before);
  });

  it('marks the wrapper candidate unresolvable, without applying it, when a member fails', async () => {
    const doc = wrapperDoc();
    const roleName = suggest(doc, '刺史', 'roleName');
    const persName = suggest(doc, '範', 'persName');
    const { groups } = groupWrapperCandidateSuggestions([roleName, persName]);
    const candidate = groups[0]!.suggestion;
    // Poison one member so it can no longer resolve — anchor resolution
    // falls back to a whole-document text search, so a bad xpath alone
    // isn't enough; the surface itself must not exist in the document.
    candidate.compoundMembers![0]!.anchor.surface = '不存在';
    candidate.compoundMembers![0]!.anchor.nodeHash = 'stale';

    const { applied, results } = await applyWithWrapperCandidates(doc, [candidate], {
      policy: 'ignore',
    });

    expect(applied).toBe(1); // only the healthy member ('範' as persName) applied
    const candidateResult = results.find((r) => r.suggestion === candidate);
    expect(candidateResult?.outcome).toBe('unresolvable');
    expect(candidate.status).toBe('unresolvable');
    expect(doc.getElementsByTagName('name')).toHaveLength(0); // wrap never attempted
  });

  it('falls through to ordinary applySuggestions when nothing has compoundMembers', async () => {
    const doc = wrapperDoc();
    const roleName = suggest(doc, '刺史', 'roleName');

    const { applied } = await applyWithWrapperCandidates(doc, [roleName], { policy: 'ignore' });

    expect(applied).toBe(1);
    expect(doc.getElementsByTagName('roleName')[0]!.textContent).toBe('刺史');
  });
});
