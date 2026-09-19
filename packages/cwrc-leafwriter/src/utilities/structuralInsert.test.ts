import {
  splitElementAtRange,
  splitParagraphAtCursor,
  insertStructuralElementAtCursor,
} from './structuralInsert';
import type Writer from '../js/Writer';

/**
 * A minimal but structurally faithful fake of the pieces `structuralInsert`
 * touches on `Writer` - real jsdom DOM/Range (the actual risk here is DOM
 * surgery, not TinyMCE), a stateful fake selection so the multi-level split
 * loop in `insertStructuralElementAtCursor` sees its own updates, and a fake
 * `addStructureTag` that mirrors just enough of the real tagger's ADD path
 * (seed a `\uFEFF` sentinel, insert at the collapsed cursor, assign an id)
 * to exercise the orchestration logic - the tagger's own DOM-building is
 * already relied on untested elsewhere in this codebase and is out of scope
 * here.
 */
const makeFakeWriter = (
  body: HTMLElement,
  options: {
    validParents?: Record<string, string[]>;
    textContaining?: string[];
  } = {},
): Writer => {
  let currentRange: Range = document.createRange();
  currentRange.selectNodeContents(body);
  currentRange.collapse(true);

  let idCounter = 0;

  const selection = {
    getRng: (_normalized?: boolean) => currentRange,
    setRng: (rng: Range) => {
      currentRange = rng;
    },
    getBookmark: (_type: number) => ({ rng: currentRange }),
  };

  const editor = {
    getBody: () => body,
    selection,
    dom: { createRng: () => document.createRange() },
  };

  const tagger = {
    ADD: 'ADD',
    AFTER: 'AFTER',
    addStructureTag: ({
      action,
      tagName,
      attributes,
      bookmark,
    }: {
      action: string;
      tagName: string;
      attributes: Record<string, unknown>;
      bookmark: unknown;
    }): Element => {
      const el = document.createElement('span');
      el.setAttribute('_tag', tagName);
      el.id = `dom_${idCounter++}`;
      el.setAttribute('_attributes', JSON.stringify(attributes ?? {}).replace(/"/g, '&quot;'));
      for (const [key, value] of Object.entries(attributes ?? {})) {
        el.setAttribute(key, String(value));
      }
      el.appendChild(document.createTextNode('﻿'));

      const tagId = (bookmark as { tagId?: string } | undefined)?.tagId;
      if (action === 'AFTER' && tagId) {
        // Mirrors the real tagger: an id-addressed bookmark targets that
        // element directly, ignoring the live selection entirely.
        document.getElementById(tagId)!.after(el);
        return el;
      }

      const rng = currentRange;
      rng.insertNode(el);
      const after = document.createRange();
      after.selectNodeContents(el);
      after.collapse(false);
      currentRange = after;
      return el;
    },
    processNewContent: () => {},
  };

  const validParents = options.validParents ?? {};
  const textContaining = new Set(options.textContaining ?? []);

  const schemaManager = {
    isTagValidChildOfParent: (child: string, parent: string) =>
      (validParents[child] ?? []).includes(parent),
    canTagContainText: (tag: string) => textContaining.has(tag),
  };

  return {
    editor,
    tagger,
    schemaManager,
    getUniqueId: (prefix: string) => `${prefix}${idCounter++}`,
    event: () => ({ publish: jest.fn() }),
  } as unknown as Writer;
};

const setCursor = (writer: Writer, node: Node, offset: number) => {
  const rng = document.createRange();
  rng.setStart(node, offset);
  rng.collapse(true);
  (writer.editor as unknown as { selection: { setRng: (r: Range) => void } }).selection.setRng(rng);
};

describe('splitElementAtRange', () => {
  it('splits an element into two siblings at the cursor, dividing its text content', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body);
    const p1 = document.getElementById('p1')!;
    const textNode = p1.firstChild!;

    const rng = document.createRange();
    rng.setStart(textNode, 5); // right after "Hello"
    rng.collapse(true);

    const secondHalf = splitElementAtRange(writer, p1, rng);

    expect(p1.textContent).toBe('Hello');
    expect(secondHalf.textContent).toBe(' World');
    expect(secondHalf.getAttribute('_tag')).toBe('p');
    expect(secondHalf.id).not.toBe(p1.id);
    expect(secondHalf.previousElementSibling).toBe(p1);
  });

  it('strips xml:id from the split-off half but leaves the original untouched', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p" xml:id="para-1" ' +
      '_attributes="{&quot;xml:id&quot;:&quot;para-1&quot;}">Hello World</span></span>';
    const writer = makeFakeWriter(document.body);
    const p1 = document.getElementById('p1')!;
    const textNode = p1.firstChild!;

    const rng = document.createRange();
    rng.setStart(textNode, 5);
    rng.collapse(true);

    const secondHalf = splitElementAtRange(writer, p1, rng);

    expect(p1.getAttribute('xml:id')).toBe('para-1');
    expect(secondHalf.hasAttribute('xml:id')).toBe(false);
    const secondAttrs = JSON.parse(secondHalf.getAttribute('_attributes')!.replace(/&quot;/g, '"'));
    expect(secondAttrs['xml:id']).toBeUndefined();
  });

  it('reassigns a fresh id to a nested element the browser clones across the split boundary', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">before ' +
      '<span id="ent1" _tag="persName">John</span> after</span></span>';
    const writer = makeFakeWriter(document.body);
    const p1 = document.getElementById('p1')!;
    const nameTextNode = document.getElementById('ent1')!.firstChild!;

    // Cursor lands inside "John" (between "Jo" and "hn") - the persName span
    // straddles the split point, so extractContents clones it.
    const rng = document.createRange();
    rng.setStart(nameTextNode, 2);
    rng.collapse(true);

    splitElementAtRange(writer, p1, rng);

    const matches = document.querySelectorAll('#ent1');
    expect(matches.length).toBe(1); // the id must stay unique document-wide
    const clones = document.body.querySelectorAll('[_tag="persName"]');
    expect(clones.length).toBe(2); // but the element itself was legitimately split in two
    expect(clones[0].id).toBe('ent1');
    expect(clones[1].id).not.toBe('ent1');
  });
});

describe('splitParagraphAtCursor', () => {
  it('splits the nearest <p> ancestor into two at the cursor', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body);
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5);

    const result = splitParagraphAtCursor(writer);

    expect(result).toBe(true);
    const paragraphs = document.querySelectorAll('[_tag="p"]');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('Hello');
    expect(paragraphs[1].textContent).toBe(' World');
  });

  it('returns false when the cursor is not inside a <p>', () => {
    document.body.innerHTML = '<span id="d1" _tag="div">no paragraph here</span>';
    const writer = makeFakeWriter(document.body);
    setCursor(writer, document.getElementById('d1')!.firstChild!, 3);

    const result = splitParagraphAtCursor(writer);

    expect(result).toBe(false);
    expect(document.querySelectorAll('[_tag="p"]')).toHaveLength(0);
  });
});

describe('insertStructuralElementAtCursor', () => {
  it('inserts a milestone-like element directly, with no ancestor splitting, when the schema allows it as a child of the current tag', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body, {
      validParents: { lb: ['p'] },
      textContaining: [], // lb cannot contain text
    });
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5);

    const result = insertStructuralElementAtCursor(writer, 'lb');

    expect(result).toBe(true);
    expect(document.querySelectorAll('[_tag="p"]')).toHaveLength(1); // no split needed
    const lb = document.querySelector('[_tag="lb"]')!;
    expect(lb).not.toBeNull();
    expect(lb.getAttribute('_textallowed')).toBe('false');
    expect(lb.getAttribute('contenteditable')).toBe('false');
    expect(lb.textContent).toBe(''); // sentinel cleared - lb can never hold text
  });

  it('splits the enclosing <p> and inserts the new element as a sibling when it is only valid one level up', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body, {
      validParents: { head: ['div'] }, // not valid inside <p>
      textContaining: ['head'],
    });
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5);

    const result = insertStructuralElementAtCursor(writer, 'head');

    expect(result).toBe(true);
    const div = document.getElementById('d1')!;
    const children = Array.from(div.children).map((el) => el.getAttribute('_tag'));
    expect(children).toEqual(['p', 'head', 'p']);
    expect(div.children[0].textContent).toBe('Hello');
    expect(div.children[2].textContent).toBe(' World');
    // head can hold text, so unlike the milestone case its sentinel stays
    // (that's where the user types the heading).
    expect(div.children[1].getAttribute('contenteditable')).not.toBe('false');
  });

  it('returns false without changing the document when no ancestor can contain the element', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body, {
      validParents: {}, // nothing is ever a valid parent
    });
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5);

    const result = insertStructuralElementAtCursor(writer, 'bogus');

    expect(result).toBe(false);
    expect(document.querySelectorAll('[_tag="p"]')).toHaveLength(1);
    expect(document.getElementById('p1')!.textContent).toBe('Hello World');
  });

  it('sets attributes (e.g. a page number) on the inserted element', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body, {
      validParents: { pb: ['p'] },
      textContaining: [],
    });
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5);

    insertStructuralElementAtCursor(writer, 'pb', { n: '12' });

    const pb = document.querySelector('[_tag="pb"]')!;
    expect(pb.getAttribute('n')).toBe('12');
  });

  it('appends an empty trailing paragraph after a heading inserted at the end of a section, when none follows', () => {
    document.body.innerHTML = '<span id="d1" _tag="div">Section Title</span>';
    const writer = makeFakeWriter(document.body, {
      validParents: { head: ['div'], p: ['div'] },
      textContaining: ['head'],
    });
    const div = document.getElementById('d1')!;
    setCursor(writer, div.firstChild!, div.firstChild!.textContent!.length); // cursor at the very end

    const result = insertStructuralElementAtCursor(writer, 'head');

    expect(result).toBe(true);
    const children = Array.from(div.children).map((el) => el.getAttribute('_tag'));
    expect(children).toEqual(['head', 'p']);
  });

  it('does not add a trailing paragraph after a heading that already has content following it', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body, {
      validParents: { head: ['div'], p: ['div'] },
      textContaining: ['head'],
    });
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5); // mid-paragraph

    insertStructuralElementAtCursor(writer, 'head');

    const div = document.getElementById('d1')!;
    const children = Array.from(div.children).map((el) => el.getAttribute('_tag'));
    // the split already produced a trailing <p> - no extra one should appear
    expect(children).toEqual(['p', 'head', 'p']);
  });

  it('fills a heading with prefilled text (from the heading-text prompt) instead of an empty sentinel', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body, {
      validParents: { head: ['div'] },
      textContaining: ['head'],
    });
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5);

    insertStructuralElementAtCursor(writer, 'head', {}, { text: 'Chapter One' });

    const head = document.querySelector('[_tag="head"]')!;
    expect(head.textContent).toBe('Chapter One');
  });

  it('moves the caret into the following paragraph after a prefilled heading, not into the heading itself', () => {
    document.body.innerHTML =
      '<span id="d1" _tag="div"><span id="p1" _tag="p">Hello World</span></span>';
    const writer = makeFakeWriter(document.body, {
      validParents: { head: ['div'] },
      textContaining: ['head'],
    });
    setCursor(writer, document.getElementById('p1')!.firstChild!, 5);

    insertStructuralElementAtCursor(writer, 'head', {}, { text: 'Chapter One' });

    const head = document.querySelector('[_tag="head"]')!;
    const followingParagraph = head.nextElementSibling!;
    expect(followingParagraph.getAttribute('_tag')).toBe('p');
    const rng = (
      writer.editor as unknown as { selection: { getRng: () => Range } }
    ).selection.getRng();
    expect(rng.startContainer).toBe(followingParagraph);
    expect(rng.startOffset).toBe(0);
  });
});
