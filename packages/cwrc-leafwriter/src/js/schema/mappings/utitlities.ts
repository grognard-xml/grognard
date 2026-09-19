import $ from 'jquery';

import { fetchResourceText, resolveDocumentAssetUrl } from '../../../utilities/fetchResource';
import { findGlyphCharDeclEntry } from '../../../utilities/glyphCharDecl';

/** The full document XML (with header) lives separately from the visual
 * editor's DOM - it's stripped before load and merged back in at save time
 * (see stripTeiHeaderForVisualEditor/mergeEditorBodyWithStoredHeader in
 * apps/commons) - so a `<charDecl>` entry can't be found via jQuery on the
 * body the way everything else in this file works. This mirrors the same
 * `__desktopStoredDocumentXml` read used elsewhere in this package
 * (autoTagging/documentContent.ts, useTeiHeaderRepairPrompt.tsx). */
const getStoredDocumentXml = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.__desktopStoredDocumentXml ?? window.writer?.overmindState?.document?.xml ?? null;
};

export interface HandleGraphicsOptions {
  documentFilePath?: string | null;
}

const activeDocumentFilePath = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.__leafWriterProject?.getActiveFilePath?.() ?? null;
};

const isKanripoGaijiGraphic = ($tag: JQuery<Element>): boolean => {
  const $parent = $tag.parent();
  return $parent.attr('_tag') === 'g' && $parent.attr('type') === 'kanripo';
};

/** Matches the legacy `<g type="glyph"><graphic type="source|normalized">`
 * shape (both graphics as children of the wrapper). Schemas that define
 * `<g>`/`<charDecl>` now use `<g ref="#id">` instead (see
 * isGlyphRefElement) - this only remains for documents inserted before
 * that change. */
const isGlyphGraphic = ($tag: JQuery<Element>): boolean => {
  const $parent = $tag.parent();
  return $parent.attr('_tag') === 'g' && $parent.attr('type') === 'glyph';
};

/** TEI Lite defines neither `<g>` nor `<charDecl>`/`<glyph>`, so a glyph
 * there is a bare `<graphic type="glyph">` sitting directly in the running
 * text - no wrapper, no charDecl entry, no source-provenance sibling. */
const isBareGlyphGraphic = ($tag: JQuery<Element>): boolean => $tag.attr('type') === 'glyph';

/** The current, schema-clean shape: `<g ref="#id" type="glyph">` in the
 * running text, with the actual graphics registered once in
 * `<teiHeader><encodingDesc><charDecl>` - see glyphCharDecl.ts. */
const isGlyphRefElement = ($tag: JQuery<Element>): boolean =>
  $tag.attr('_tag') === 'g' && $tag.attr('type') === 'glyph' && Boolean($tag.attr('ref'));

/**
 * Tagger.insert always seeds empty structure tags with `\uFEFF` so TinyMCE
 * won't delete them. TEI `<graphic>` cannot contain text, so an XML reload
 * builds those elements empty — and glyphs then align. The sentinel text
 * strut inside a `display:block` 1em box is what makes freshly inserted
 * glyphs hang below the line until save/reload. Strip it (and tell TinyMCE
 * the tag still may not hold text) whenever we style a glyph graphic.
 */
const clearEmptyTagSentinel = ($tag: JQuery<Element>) => {
  const el = $tag[0];
  if (!el) return;
  $tag.attr('_textallowed', 'false');
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text === '' || text === '\uFEFF') child.parentNode?.removeChild(child);
    }
  }
};

/** The raw pasted bytes kept alongside a `<g type="glyph">` for provenance
 * (an "original vs. cleaned" comparison later) - never rendered itself, and
 * never resizable via TinyMCE's own drag handles (there's nothing visible
 * to resize). */
const applyHiddenGlyphSource = ($tag: JQuery<Element>) => {
  clearEmptyTagSentinel($tag);
  $tag.addClass('lw-glyph-source');
  $tag.attr('contenteditable', 'false');
  $tag.attr('data-mce-resize', 'false');
  $tag.css('display', 'none');
};

/**
 * Unlike the Kanripo gaiji's CSS `background-image` (which can't inherit
 * `currentColor`), the glyph's normalized graphic needs to recolor with
 * surrounding text and follow light/dark theme. An earlier version injected
 * the fetched `<svg>` markup as real innerHTML to get that, but that content
 * lives only in the live DOM: the tagger's XML model doesn't recognize
 * unmarked foreign markup as document content, so the `<graphic>` element
 * serialized back out with nothing inside it - the glyph would vanish on
 * save/reload, and TinyMCE's own content-processing passes could mangle it
 * in the meantime (both matched what was actually observed).
 *
 * A CSS mask (an alpha shape, painted with `background-color: currentColor`)
 * sidesteps that: nothing is written into the tagged content. But masking
 * reads per-pixel data from its source to compute the mask, so it's subject
 * to the same cross-origin restriction as canvas/filter - a resource loaded
 * across origins (here, the app's own `grognard://` asset scheme vs.
 * whatever origin serves the editor) is silently treated as unusable,
 * confirmed by a controlled same-origin-vs-cross-origin test of this exact
 * technique. Inlining the SVG as a `data:` URI avoids the restriction
 * entirely: its bytes are already in the document, no cross-origin fetch
 * involved. That does mean the mask can only be set once the file's been
 * read (async), unlike a plain `url(...)` - but only a CSS property is
 * being set either way, still nothing written into the tagged content.
 *
 * The graphic sits in a 1em×1em CJK character cell (same idea as Kanripo
 * gaiji), with the mask scaled via `contain` so odd ink aspect ratios do
 * not stretch the slot to 2em wide. Schema CSS (tei.css's `graphic {
 * color: gray }`, rewritten onto `[_tag=graphic]`) would otherwise tint
 * `currentColor` — force `color: inherit` so the ink tracks surrounding
 * text. Width/height TEI attributes from vectorizeGlyphImage() stay on
 * the element for provenance; they are not used for layout.
 *
 * `standalone` is true when `$tag` itself sits directly in the running
 * text with no separate wrapper to own the line-box baseline - the TEI
 * Lite bare-graphic fallback, and the new `<g ref="#id">` shape (which,
 * unlike the legacy dual-graphic shape, has no child element to be a
 * "wrap" around). Both cases need their own inline-block + baseline
 * instead of relying on a `.lw-glyph-wrap` ancestor.
 */
const applyMaskedGlyph = ($tag: JQuery<Element>, url: string, standalone: boolean) => {
  clearEmptyTagSentinel($tag);
  $tag.addClass('lw-inline-glyph');
  $tag.attr('contenteditable', 'false');
  $tag.attr('data-mce-resize', 'false');
  $tag.css({
    // Match applyEmSizedGraphic: block inside an inline-block wrap so the
    // wrap owns the line-box baseline and the mask fills a fixed em cell -
    // unless standalone, in which case this element owns it directly.
    display: standalone ? 'inline-block' : 'block',
    height: '1em',
    width: '1em',
    lineHeight: '0',
    verticalAlign: standalone ? 'baseline' : '',
    // Keep ink centered in the 1em cell. (Kanripo's "center bottom" + the
    // same nudge hangs masked glyphs under the line — masks and
    // background-images do not share the same paint box.)
    //
    // `vertical-align: baseline` aligns to the font's *alphabetic* baseline,
    // but CJK glyphs are conventionally drawn against a lower "ideographic"
    // baseline/centred within their em box — so any Latin-metrics-aligned
    // inline box (ours included) reads as sitting too high next to real CJK
    // ink, by an amount that depends on the surrounding font, not on us.
    // There's no DOM API to query that gap for an arbitrary font, so this
    // stays a manual constant — exposed as a CSS custom property so it can
    // be tuned live (DevTools, or a project stylesheet override) against
    // the actual editor font without a rebuild.
    transform: 'translateY(var(--lw-glyph-baseline-shift, 0.22em))',
    // Beat schema `graphic { color: gray }` so the mask paints with the
    // surrounding text colour (inline style wins over non-!important rules).
    color: 'inherit',
    backgroundColor: 'currentColor',
    maskSize: 'contain',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
  });

  void fetchResourceText(url).then((svgText) => {
    if (!svgText) return;
    // Re-clear in case TinyMCE re-seeded \uFEFF while the SVG was loading.
    clearEmptyTagSentinel($tag);
    const dataUrl = `data:image/svg+xml,${encodeURIComponent(svgText)}`;
    $tag.css({ maskImage: `url("${dataUrl}")`, WebkitMaskImage: `url("${dataUrl}")` });
  });

  const $wrap = standalone ? $() : $tag.parent();
  if ($wrap.attr('_tag') === 'g' && $wrap.attr('type') === 'glyph') {
    clearEmptyTagSentinel($wrap);
    $wrap.addClass('lw-glyph-wrap');
    $wrap.attr('data-mce-resize', 'false');
    $wrap.attr('_textallowed', 'false');
    $wrap.css({
      display: 'inline-block',
      verticalAlign: 'baseline',
      lineHeight: '0',
      width: '1em',
      height: '1em',
      padding: '0',
      margin: '0',
      color: 'inherit',
    });
  }
};

/**
 * Renders a `<g ref="#id" type="glyph">` element: resolves the id against
 * `<teiHeader><encodingDesc><charDecl>` in the full document XML (not the
 * visual DOM - see getStoredDocumentXml) and masks `$tag` itself directly,
 * since there's no separate wrapper/inner-graphic split for this shape.
 * If the id can't be resolved (bad ref, or the header hasn't loaded yet),
 * this leaves the element unstyled rather than guessing.
 */
const applyGlyphRefElement = ($tag: JQuery<Element>, documentFilePath: string | null) => {
  const refAttr = $tag.attr('ref') ?? '';
  const glyphId = refAttr.startsWith('#') ? refAttr.slice(1) : refAttr;
  if (!glyphId) return;

  const storedXml = getStoredDocumentXml();
  if (!storedXml) return;

  const entry = findGlyphCharDeclEntry(storedXml, glyphId);
  if (!entry) return;

  const url = resolveDocumentAssetUrl(entry.svgUrl, documentFilePath);
  applyMaskedGlyph($tag, url, true);
};

const applyEmSizedGraphic = ($tag: JQuery<Element>, url: string, heightAttr: string) => {
  $tag.addClass('lw-inline-graphic lw-kanripo-gaiji');
  $tag.attr('contenteditable', 'false');
  $tag.css({
    display: 'block',
    height: heightAttr,
    width: '1em',
    lineHeight: '0',
    backgroundImage: `url("${url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center bottom',
    backgroundSize: 'auto 100%',
    transform: 'translateY(0.12em)',
  });

  const $wrap = $tag.parent();
  if ($wrap.attr('_tag') === 'g' && $wrap.attr('type') === 'kanripo') {
    $wrap.addClass('lw-kanripo-gaiji-wrap');
    $wrap.css({
      display: 'inline-block',
      verticalAlign: 'baseline',
      lineHeight: '0',
      padding: '0',
      margin: '0',
    });
  }

  const $img = $('<img />');
  $img.attr('src', url);
  $img.hide();
  $img.on('load', function (this: HTMLImageElement) {
    const naturalWidth = this.naturalWidth || 1;
    const naturalHeight = this.naturalHeight || 1;
    const emHeight = parseFloat(heightAttr) || 1;
    $tag.css('width', `${(naturalWidth / naturalHeight) * emHeight}em`);
    $img.remove();
  });
  $img.on('error', () => $img.remove());
  $('body').append($img);
};

export const handleGraphics = ($tag: JQuery<Element>, options: HandleGraphicsOptions = {}) => {
  const documentFilePath = options.documentFilePath ?? activeDocumentFilePath();

  // `<g ref="#id">` carries no `url` of its own (the graphics live in
  // charDecl) - resolve and return before the `rawUrl` guard below, which
  // would otherwise treat it as "nothing to render".
  if (isGlyphRefElement($tag)) {
    applyGlyphRefElement($tag, documentFilePath);
    return;
  }

  const rawUrl = $tag.attr('url');
  if (!rawUrl) return;

  const url = resolveDocumentAssetUrl(rawUrl, documentFilePath);
  const heightAttr = ($tag.attr('height') || '').trim();
  const kanripoGaiji = isKanripoGaijiGraphic($tag);

  if (isGlyphGraphic($tag)) {
    // Legacy shape only: both graphics as children of a `<g type="glyph">`
    // wrapper, which owns the inline-block/baseline (standalone: false).
    if ($tag.attr('type') === 'source') {
      applyHiddenGlyphSource($tag);
    } else {
      applyMaskedGlyph($tag, url, false);
    }
    return;
  }

  if (isBareGlyphGraphic($tag)) {
    // TEI Lite fallback: no wrapper, no charDecl - this element owns its
    // own inline-block/baseline (standalone: true).
    applyMaskedGlyph($tag, url, true);
    return;
  }

  if (kanripoGaiji) {
    $tag.parent().addClass('lw-kanripo-gaiji-wrap');
  }

  if (heightAttr.endsWith('em')) {
    applyEmSizedGraphic($tag, url, heightAttr);
    return;
  }

  $tag.addClass('lw-inline-graphic');
  $tag.css('backgroundImage', `url("${url}")`);
  $tag.css('display', 'inline-block');

  const $img = $('<img />');
  $img.attr('src', url);

  $img.hide();
  $img.on('load', function () {
    $tag.width($(this).width() ?? 0);
    $tag.height($(this).height() ?? 0);
    $img.remove();
  });
  $img.on('error', () => $img.remove());

  $('body').append($img);
};

export const refreshGraphicsInBody = (
  body: HTMLElement | DocumentFragment | null | undefined,
  options: HandleGraphicsOptions = {},
) => {
  if (!body) return;
  $(body)
    .find(
      '*[_tag="graphic"], *[_tag="GRAPHIC"], *[_tag="g"][type="glyph"][ref], *[_tag="G"][type="glyph"][ref]',
    )
    .each((_index, element) => handleGraphics($(element), options));
};
