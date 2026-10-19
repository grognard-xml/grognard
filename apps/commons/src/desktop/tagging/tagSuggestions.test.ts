import type { NodeDetail } from '@cwrc/leafwriter-validator';
import {
  filterTagSuggestions,
  getDefaultHighlightIndex,
  getEditorTagContext,
  pinParagraphInsertOption,
  sortTagSuggestions,
  withCustomThingTypeOptions,
  withInsertModeFallbacks,
  withRespStmtOption,
} from './tagSuggestions';

const tag = (name: string, invalid = false): NodeDetail => ({
  name,
  type: 'tag',
  eventType: 'enterStartTag',
  invalid,
});

describe('sortTagSuggestions', () => {
  test('orders by project usage then alphabetically', () => {
    const sorted = sortTagSuggestions([tag('note'), tag('persName'), tag('placeName')], {
      persName: 5,
      note: 1,
    });
    expect(sorted.map((item) => item.name)).toEqual(['persName', 'note', 'placeName']);
  });

  test('moves preferred tag to front when present', () => {
    const sorted = sortTagSuggestions([tag('note'), tag('persName'), tag('p')], {}, 'p');
    expect(sorted[0]?.name).toBe('p');
  });
});

describe('filterTagSuggestions', () => {
  test('filters by tag name substring', () => {
    const filtered = filterTagSuggestions([tag('persName'), tag('placeName'), tag('p')], 'place');
    expect(filtered.map((item) => item.name)).toEqual(['placeName']);
  });

  test('ranks tag-name prefixes ahead of partial matches', () => {
    const filtered = filterTagSuggestions([tag('persName'), tag('name'), tag('placeName')], 'name');
    expect(filtered.map((item) => item.name)).toEqual(['name', 'persName', 'placeName']);
  });

  test('matches the "rs" tag when the query is the entity-kind label "thing"', () => {
    const filtered = filterTagSuggestions([tag('persName'), tag('rs'), tag('placeName')], 'thing');
    expect(filtered.map((item) => item.name)).toEqual(['rs']);
  });

  test('matches "title"/"bibl" when the query is the entity-kind label "work"', () => {
    const filtered = filterTagSuggestions([tag('title'), tag('bibl'), tag('persName')], 'work');
    expect(filtered.map((item) => item.name)).toEqual(['title', 'bibl']);
  });

  test('matches a synthetic thing-type entry by its own displayLabel, not the shared "rs" name', () => {
    const plainRs = tag('rs');
    const medicinalPlant: NodeDetail = {
      ...tag('rs'),
      displayLabel: 'Medicinal plant',
      attributeOverrides: { type: 'medicinal_plant' },
    };
    const philosophicalConcept: NodeDetail = {
      ...tag('rs'),
      displayLabel: 'Philosophical concept',
      attributeOverrides: { type: 'philosophical_concept' },
    };
    const tags = [plainRs, medicinalPlant, philosophicalConcept];

    expect(filterTagSuggestions(tags, 'medicinal').map((item) => item.displayLabel)).toEqual([
      'Medicinal plant',
    ]);
    // Typing the generic kind label still surfaces only the plain entry, not
    // every custom-labeled one — each labeled entry is matched on its own label.
    expect(filterTagSuggestions(tags, 'thing').map((item) => item.displayLabel ?? null)).toEqual([
      null,
    ]);
  });
});

describe('withCustomThingTypeOptions', () => {
  test('splices one synthetic entry per custom type when "rs" is a valid suggestion', () => {
    const tags = [tag('persName'), tag('rs')];
    const withTypes = withCustomThingTypeOptions(tags, [
      { id: 'medicinal_plant', label: 'Medicinal plant' },
      { id: 'philosophical_concept', label: 'Philosophical concept' },
    ]);
    expect(withTypes).toHaveLength(4);
    const synthetic = withTypes.filter((item) => item.displayLabel);
    expect(synthetic.map((item) => item.displayLabel)).toEqual([
      'Medicinal plant',
      'Philosophical concept',
    ]);
    expect(synthetic.every((item) => item.name === 'rs')).toBe(true);
    expect(synthetic.map((item) => item.attributeOverrides)).toEqual([
      { type: 'medicinal_plant' },
      { type: 'philosophical_concept' },
    ]);
  });

  test('does nothing when there are no custom types', () => {
    const tags = [tag('persName'), tag('rs')];
    expect(withCustomThingTypeOptions(tags, [])).toBe(tags);
  });

  test('does nothing when "rs" is not a valid suggestion at this location', () => {
    const tags = [tag('persName'), tag('rs', true)];
    const withTypes = withCustomThingTypeOptions(tags, [
      { id: 'medicinal_plant', label: 'Medicinal plant' },
    ]);
    expect(withTypes).toBe(tags);
  });
});

describe('pinParagraphInsertOption', () => {
  test('pins p first when caret is inside a paragraph', () => {
    const ctx = {
      element: { getAttribute: () => 'p' } as unknown as Element,
      hasContentSelection: false,
      rng: { startContainer: { nodeType: Node.TEXT_NODE, parentNode: null } } as unknown as Range,
      tagElement: { getAttribute: () => 'p' } as unknown as Element,
    };
    const body = document.createElement('div');
    const p = document.createElement('div');
    p.setAttribute('_tag', 'p');
    const text = document.createTextNode('Jean');
    p.appendChild(text);
    body.appendChild(p);
    (ctx.rng as { startContainer: Node }).startContainer = text;
    (window as unknown as { writer: { editor: { getBody: () => Element } } }).writer = {
      editor: { getBody: () => body },
    };

    const result = pinParagraphInsertOption(
      [{ name: 'persName', type: 'tag', eventType: 'enterStartTag' }],
      'insert',
      ctx,
    );
    expect(result[0]?.name).toBe('p');
    expect(result[0]?.invalid).toBe(false);
  });
});

describe('withInsertModeFallbacks', () => {
  test('offers p when validator returns nothing inside a paragraph', () => {
    const ctx = {
      element: { getAttribute: () => 'p' } as unknown as Element,
      hasContentSelection: false,
      rng: { collapsed: true } as Range,
      tagElement: { getAttribute: () => 'p' } as unknown as Element,
    };
    expect(withInsertModeFallbacks([], 'insert', ctx)).toEqual([
      expect.objectContaining({ name: 'p', invalid: false }),
    ]);
  });
});

describe('getDefaultHighlightIndex', () => {
  test('prefers p in insert mode', () => {
    const tags = [tag('note'), tag('p'), tag('persName')];
    expect(getDefaultHighlightIndex(tags, 'insert', null)).toBe(1);
  });

  test('skips invalid preferred tag', () => {
    const tags = [tag('note'), tag('p', true), tag('persName')];
    expect(getDefaultHighlightIndex(tags, 'insert', 'p')).toBe(0);
  });
});

describe('getEditorTagContext', () => {
  const mountTaggedBody = () => {
    const body = document.createElement('div');
    const tagged = document.createElement('span');
    tagged.setAttribute('_tag', 'persName');
    const text = document.createTextNode('Ada');
    tagged.appendChild(text);
    body.appendChild(tagged);
    return { body, tagged, text };
  };

  test('finds tag from range start when selection node is the editor body', () => {
    const { body, tagged, text } = mountTaggedBody();
    const rng = document.createRange();
    rng.setStart(text, 1);
    rng.collapse(true);

    (
      window as unknown as {
        writer: {
          editor: {
            getBody: () => Element;
            selection: { getNode: () => Node; getRng: () => Range };
          };
        };
      }
    ).writer = {
      editor: {
        getBody: () => body,
        selection: {
          getNode: () => body,
          getRng: () => rng,
        },
      },
    };

    const ctx = getEditorTagContext();
    expect(ctx?.tagElement).toBe(tagged);
    expect(ctx?.element.getAttribute('_tag')).toBe('persName');
  });

  test('returns null when caret is outside tagged content', () => {
    const body = document.createElement('div');
    const text = document.createTextNode('plain');
    body.appendChild(text);
    const rng = document.createRange();
    rng.setStart(text, 0);
    rng.collapse(true);

    (
      window as unknown as {
        writer: {
          editor: {
            getBody: () => Element;
            selection: { getNode: () => Node; getRng: () => Range };
          };
        };
      }
    ).writer = {
      editor: {
        getBody: () => body,
        selection: {
          getNode: () => body,
          getRng: () => rng,
        },
      },
    };

    expect(getEditorTagContext()).toBeNull();
  });
});

describe('withRespStmtOption', () => {
  it('makes a listed respStmt selectable and leaves other tags alone', () => {
    const result = withRespStmtOption([tag('respStmt', true), tag('hi', true), tag('p')]);
    expect(result.map((t) => t.invalid)).toEqual([false, true, false]);
  });
});
