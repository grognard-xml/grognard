import $ from 'jquery';

import { ensureGlyphCharDeclEntry } from '../../../utilities/glyphCharDecl';
import { handleGraphics, refreshGraphicsInBody } from './utitlities';

const TEI_NS = 'http://www.tei-c.org/ns/1.0';

const baseXmlWithCharDecl = () =>
  ensureGlyphCharDeclEntry(
    `<TEI xmlns="${TEI_NS}"><teiHeader><fileDesc/></teiHeader><text><body/></text></TEI>`,
    {
      glyphId: 'glyph-1',
      sourceUrl: '_glyphs/glyph-1.png',
      svgUrl: '_glyphs/glyph-1.svg',
      svgWidth: 41,
      svgHeight: 49,
    },
  ) as string;

afterEach(() => {
  window.__desktopStoredDocumentXml = undefined;
  document.body.innerHTML = '';
});

describe('handleGraphics / refreshGraphicsInBody - glyph shapes', () => {
  it('renders a <g ref="#id"> element by resolving the charDecl entry directly onto it', () => {
    window.__desktopStoredDocumentXml = baseXmlWithCharDecl();

    document.body.innerHTML =
      '<p>x<span _tag="g" type="glyph" n="glyph-1" ref="#glyph-1">﻿</span>y</p>';

    refreshGraphicsInBody(document.body);

    const $g = $('[_tag="g"]', document.body);
    expect($g.css('display')).toBe('inline-block');
    expect($g.css('vertical-align')).toBe('baseline');
    expect($g.attr('data-mce-resize')).toBe('false');
    // The insert-time ZWSP sentinel must be stripped so a freshly
    // inserted glyph doesn't hang below the line until save/reload.
    expect($g.text()).toBe('');
  });

  it('does not style a <g ref> element when the id cannot be resolved', () => {
    window.__desktopStoredDocumentXml = baseXmlWithCharDecl();

    document.body.innerHTML =
      '<p><span _tag="g" type="glyph" n="glyph-missing" ref="#glyph-missing">﻿</span></p>';

    refreshGraphicsInBody(document.body);

    const $g = $('[_tag="g"]', document.body);
    expect($g.hasClass('lw-inline-glyph')).toBe(false);
  });

  it('renders a bare TEI-Lite <graphic type="glyph"> standalone, with no wrapper needed', () => {
    document.body.innerHTML =
      '<p><span _tag="graphic" type="glyph" url="_glyphs/x.svg" mimeType="image/svg+xml" width="41" height="49">﻿</span></p>';

    refreshGraphicsInBody(document.body);

    const $graphic = $('[_tag="graphic"]', document.body);
    expect($graphic.hasClass('lw-inline-glyph')).toBe(true);
    expect($graphic.css('display')).toBe('inline-block');
    expect($graphic.css('vertical-align')).toBe('baseline');
  });

  it('still renders the legacy <g type="glyph"><graphic source/normalized></g> shape', () => {
    document.body.innerHTML =
      '<span _tag="g" type="glyph" n="glyph-legacy">' +
      '<span _tag="graphic" type="source" url="_glyphs/legacy.png">﻿</span>' +
      '<span _tag="graphic" type="normalized" url="_glyphs/legacy.svg" width="10" height="10">﻿</span>' +
      '</span>';

    refreshGraphicsInBody(document.body);

    const $source = $('[_tag="graphic"][type="source"]', document.body);
    const $normalized = $('[_tag="graphic"][type="normalized"]', document.body);
    expect($source.css('display')).toBe('none');
    expect($normalized.hasClass('lw-inline-glyph')).toBe(true);
    // Legacy shape relies on the wrap for baseline, not the graphic itself.
    expect($normalized.css('display')).toBe('block');
    const $wrap = $('[_tag="g"][type="glyph"]', document.body);
    expect($wrap.css('display')).toBe('inline-block');
  });

  it('handleGraphics ignores a graphic with no url and no ref', () => {
    document.body.innerHTML = '<span _tag="graphic">x</span>';
    const $tag = $('[_tag="graphic"]', document.body);
    expect(() => handleGraphics($tag)).not.toThrow();
    expect($tag.hasClass('lw-inline-glyph')).toBe(false);
  });
});
