# Tag boundary keyboard navigation

**Status (2026-10-22):** The three-position navigator described below is **not in the code**. It was removed on 2026-06-30 (`06ba60649`, "Window screwed up"). The 2026-08-01 "mostly shipped" line was added a month later and is wrong. What remains is boundary highlighting plus immediate unwrap when Backspace/Delete is aimed into a tag. Bug H is retired with the second stop. Bugs B and C (and the regressed inside-offset-0 insert) are tracked in GitHub issue 40. The fix being tried owns the edit in `beforeinput` / `compositionend` via `packages/cwrc-leafwriter/src/js/tinymce/tagBoundaryInput.ts`, instead of restoring arrow-key stops.

The sections below are the design note for the removed navigator. Read them as history.

## Goal

Three-position cursor model for XML tag brackets in show-tags mode.
There are three distinct visual/interaction states at each tag boundary.

**Updated model (as of 2026-06-30)** — the R2L model was revised mid-implementation.
The original spec had R2L position 3 land _before the opening tag_ (traversing the whole
entity). The revised spec is symmetric with L2R: position 3 enters the entity from the
other side.

```
From left (ArrowRight), approaching opening bracket:
  1. |<tag>Jean        normal caret, mild bracket highlight (opening bracket)
  2. [<tag>]Jean       tag selected, vivid highlight
  3. <tag>|Jean        caret enters tag at first char; normal editing resumes, no highlight

From right (ArrowLeft), approaching closing bracket:
  1. Jean</tag>|       normal caret, mild bracket highlight (closing bracket)
  2. Jean[</tag>]      tag selected, vivid highlight
  3. Jean|</tag>       caret enters tag at last char; normal editing resumes, no highlight
```

Continuing inward from position 3 (already inside, editing) reaches the other boundary:

```
Inside tag moving right (ArrowRight), approaching closing bracket:
  1'. Jean-|Baptiste</tag>   (last char) mild highlight (closing bracket, internal approach)
  2'. Jean-[Baptiste</tag>]  vivid
  3'. Grognard</tag>|   caret exits tag into following text; no highlight

Inside tag moving left (ArrowLeft), approaching opening bracket:
  1'. <tag>|Grognard    (first char) mild highlight (opening bracket, internal approach)
  2'. [<tag>]Grognard   vivid
  3'. |<tag>Grognard    caret exits tag into preceding text; no highlight
```

Deletion semantics at each position:

- Position 1 (mild): a destructive key aimed _into_ a tag boundary advances to position 2
  (selects the tag) rather than acting on the adjacent character. The key is consumed; no
  content is deleted. A second press from position 2 unwraps/removes the tag.
  Destructive keys aimed _away_ from the boundary act on text normally.
- Position 2 (vivid): both Backspace and Delete unwrap/remove the tag.
  Typing at position 2 should also be a no-op (not yet implemented — see deferred).
- Position 3 (inside tag): normal character editing resumes.

## Implementation

All code lives in `packages/cwrc-leafwriter/src/js/tinymce/tinymceWrapper.ts`.
CSS for the visual states is in `packages/cwrc-leafwriter/src/css/build/editor.css`.

### Entity types — critical distinction

Inline entities (e.g. `<persName>`) appear in the DOM as `<span _tag="persName" id="dom_N"
_textallowed="true">text</span>` — **no `_entity` attribute**. The span IS the entity.

Combined entities are structural tags that xml2cwrc stamps with `_entity` in addition to
`_tag` (e.g. `<div _tag="p" _entity>`). These carry both attributes.

Any code that checks only `hasAttribute('_entity')` silently ignores the more common inline
case. Throughout this code, inline entities are detected via
`el.tagName === 'SPAN' && el.hasAttribute('_tag')` and combined entities via
`el.closest('[_entity]')` (or `$(el).closest('[_entity]')`). Both checks are required.

### State variables

```typescript
let currentBoundaryElement: Element | null; // tag being highlighted
let currentBoundaryIsExternal: boolean; // cursor is in adjacent text (not tag's own text)
let currentVirtualExternal: boolean; // second stop (vivid) is active

let _keydownBoundaryWasVirtualExternal: boolean; // snapshot of virtualExternal at keydown time
let _keydownBoundaryElement: Element | null; // snapshot of boundary element at keydown time
let _pendingAdvance: {
  node: Node;
  offset: number;
  isExit?: boolean; // true → cursor lands in adjacent external text (not inside tag)
  isSuppressBoundary?: boolean; // true → suppress boundary re-engagement at the landing position
} | null;

// When an entry advance lands inside an entity (L2R at offset 0, R2L at textLen), the landing
// position coincides with the natural "internal approach" boundary that updateTagBoundaryState
// would show mild highlight for. This flag suppresses that while cursor stays at the exact
// landing position, self-clearing the moment cursor moves anywhere else.
let _suppressedBoundaryPosition: { node: Node; offset: number } | null;
```

### Key mechanisms

**`updateTagBoundaryState()`** — reads the TinyMCE selection and sets `currentBoundaryElement`
plus `currentBoundaryIsExternal`. Called on every `NodeChange`, `mouseup`, and arrow/backspace
`keyup`. The mild `tag-at-boundary` CSS class is applied automatically whenever the caret is
adjacent to a tag boundary. No press is required for the mild highlight.

Internal-start (offset 0) and internal-end (offset === textLen) both set `atBoundary = true`,
making them symmetrically visible to the boundary-advance machinery (so ArrowLeft from offset 0
shows the opening-bracket mild highlight and proceeds through vivid → exit, symmetric with
ArrowRight from offset textLen for the closing bracket).

`_suppressedBoundaryPosition` check runs just before `applyBoundaryClasses`. If cursor is at
the recorded position, `atBoundary` is forced false so the boundary stop doesn't re-engage
after a deliberate entry advance. This covers both the synchronous call from within keyup and
any async NodeChange triggered by `setRng`.

**`setVirtualExternal(true)`** — adds the `tag-external-active` CSS class (vivid highlight).
Called in `onKeyDownHandler` when the first outward arrow press is detected.

**`_pendingAdvance`** — the advance cursor target is computed in `onKeyDownHandler` (before
TinyMCE moves the cursor) but applied at the top of `onKeyUpHandler` (after TinyMCE's own keyup
entity-navigation has already run). This is necessary because TinyMCE's `keyup` entity-navigation
fires before our `keyup` handler and will bounce cursor back out of the entity if we attempt
`setRng` in `keydown`.

Entity membership (`advancedInsideEntity`) and `_suppressedBoundaryPosition` are computed
**before** `setRng` is called, so that any synchronous NodeChange triggered by `setRng` already
sees the suppression flag in place.

`clearTagBoundaryState()` is called in keyup only for **exit** advances (`isExit: true`) — not
for entry advances or "first stop pin" advances. Entry advances suppress themselves via
`_suppressedBoundaryPosition`. "First stop pin" advances (which set vivid on an internal
boundary) must not be cleared or the vivid highlight is immediately wiped.

**`isExit` vs `isSuppressBoundary` on `_pendingAdvance`:**

- `isExit: true` — cursor lands in external adjacent text. Trigger `clearTagBoundaryState()` so
  no boundary highlight lingers after exiting.
- `isSuppressBoundary: true` — cursor enters the entity (L2R at offset 0, R2L at textLen).
  Set `_suppressedBoundaryPosition` before `setRng` so the landing position is treated as
  "normal editing" rather than a new boundary stop.

**`beforeinput` interception** — capture-phase listener on `editor.getBody()`. When
`inputType === 'insertText'` fires with cursor at `(textNode, 0)` inside an entity and
`currentBoundaryElement === null` (confirming position 3), TinyMCE would route the character
_before_ the entity due to range normalization. We intercept, call `textNode.insertData(0,
event.data)` directly, advance cursor to `(textNode, data.length)`, and call
`editor.undoManager.add()`.

**TinyMCE entity-bounce reversal** — if keyup finds cursor has moved from external text into
entity text without a deliberate `_pendingAdvance`, it restores cursor to the external text at
offset 0 (ArrowLeft) or `textLen` (ArrowRight).

**Bug D (fixed) — ArrowLeft from offset=1 inside entity** — TinyMCE's keyup bounces cursor
from offset=0 to outside the entity. Intercepted in `keydown` (capture, before TinyMCE) when
`!currentBoundaryElement && offset===1 && isTagOrCombinedEl(parent) && isInlineOrCombined`.
`_pendingAdvance` pins cursor at offset=0 in keyup (no `isSuppressBoundary`; we _want_ the
boundary system to engage at offset 0 so ArrowLeft from there proceeds through mild → vivid →
exit).

## Known bugs (as of 2026-06-30)

### Bug A — (fixed) advance to inside tag (ArrowRight, position 2→3) loops back to position 1

**Status:** Fixed. Skipping `doHighlightCheck` when `_pendingAdvance` lands inside entity
prevents `highlightEntity` from calling `setRng(emptyRng)` and resetting cursor. Cursor
reliably lands at `(textNode, 0)`.

**Entity side panel** does not update when entering via keyboard (acceptable gap — entity was
already highlighted before navigation began).

### Bug A-continued — (fixed) typing at position 3 inserts before entity

**Status:** Fixed. `beforeinput` intercept (capture phase) catches `insertText` at
`(textNode, 0)` inside entity and calls `textNode.insertData(0, data)` directly, bypassing
TinyMCE's range normalization that routes input before the entity element.

Inline entity detection (`SPAN` + `_tag`, no `_entity`) was critical here — the original guard
used `closest('[_entity]')` which only catches combined entities, so the intercept never fired
for the common inline case until corrected.

### Bug B — typing at pos 1 (external, offset=0 adjacent to entity end) inserts inside entity

**Symptom:** cursor at offset=0 of text immediately after `</tag>` (external closing boundary,
position 1 from right). Typing inserts inside the entity instead of outside.

**Root cause:** TinyMCE's `CaretContainer` / entity-navigation treats offset=0 adjacent to an
entity end as a "fake caret" and routes typed characters into the entity.

**Same problem occurs at position 2** (cursor consumed / pinned at same external position):
typing at pos 2 should be a no-op, but instead TinyMCE routes characters into the entity.
Both issues have the same root cause and likely the same fix.

**Potential fixes (preferred first):**

1. Intercept `beforeinput` (capture phase). When cursor is at offset=0 in external text
   with the previous sibling being an entity span (`currentBoundaryIsExternal === true`),
   preventDefault and either: (a) do nothing (correct for pos 2); or (b) re-dispatch the
   input event with cursor explicitly moved to a safe external offset first (for pos 1, where
   typing should be allowed but outside the entity).
2. Use `editor.selection.setCursorLocation(node, offset)` before input to disambiguate the
   fake-caret position.
3. **[Last resort]** Insert a zero-width non-breaking space (U+FEFF) after the entity's
   closing boundary so TinyMCE has an unambiguous external text node. Risk: the character
   can leak into copy/paste and export.

### Bug C — cursor exits entity after first-char deletion

**Symptom:** cursor inside entity at offset=0. Delete removes the first character; cursor
should stay at offset=0 of the remaining text. Instead cursor exits and next typed char lands
before the tag.

**Root cause:** TinyMCE's `NodeChange` / entity-mutation observer moves cursor out after
content is deleted near the entity boundary.

**Potential fix:** intercept `keyup` for Delete when `currentBoundaryElement` is set and
cursor was at `isAtTextStart`; after TinyMCE processes the deletion, force cursor back to
offset=0 of the (now shorter) text node.

### Bug D — (fixed) ArrowLeft from offset=1 inside entity exits entity

**Status:** Fixed. See "Bug D" in Key mechanisms above.

### Bug E — (fixed) getPreviousTextNode from entity element re-enters entity subtree

**Status:** Fixed. Changed to start from `currentBoundaryElement.firstChild` so
`previousNode()` crosses the opening boundary rather than landing inside.

For the symmetric R2L entry case (landing at entity's own last text node), start from
`currentBoundaryElement.nextSibling` so `previousNode()` finds the entity's own last text
descendant rather than the pre-entity text.

### Bug F — (fixed) infinite loop when tag is at document boundary

**Status:** Fixed. `event.preventDefault()` only called when an advance target is found.

### Bug G — cursor position appears ambiguous at position 3 (visual rendering)

**Symptom:** after entering the entity via position 3 (L2R at offset 0, or R2L at textLen),
the blinking cursor caret is visually rendered _outside_ the entity highlight even though the
DOM selection is correctly placed at `(entityText, 0)` or `(entityText, textLen)`. Typing
confirms the placement is correct (character inserts inside), but the visual caret is
misleading.

**Root cause:** browsers have an ambiguous visual rendering choice at the boundary between a
styled inline element and its sibling text. Offset=0 of the first text child of a `<span>`
is visually indistinguishable from "just before the span" — both correspond to the same
pixel position at the left edge of the span's content area. The browser draws the caret on
the external (left) side.

**Thoughts on fixes:**

1. **CSS `direction` trick** — not applicable here since content may be RTL.
2. **Zero-width joiner / non-breaking space** — inserting a ZWJ or U+FEFF inside the entity
   at position 0 forces the caret to render inside the element, but it pollutes content.
3. **`editor.selection.setCursorLocation(node, 0)`** — TinyMCE's own method may insert a
   CaretContainer span that forces visual placement; worth trying. It has caused async
   NodeChange issues in the past (see Bug A history) but those were caused by calling it
   with the wrong arguments or at the wrong time.
4. **Accept the visual ambiguity** — since typing works correctly (characters insert inside
   via the `beforeinput` intercept), the visual mismatch may be acceptable. The mild
   highlight disappears at position 3, removing any competing visual affordance. The first
   typed character snaps the caret to the correct visual position immediately.
5. **CSS outline on the entity at position 3** — if the entity retains a subtle background or
   border at position 3 (rather than fully transparent), the cursor inside looks less
   ambiguous even if it renders at the left edge. Trade-off: may confuse "editing resumes"
   semantics.

Current status: not fixed. Option 4 (accept it) is the lowest-risk path unless the visual
confusion proves disruptive in user testing.

### Bug H — position 2 typing not blocked

**Symptom:** at position 2 (vivid, tag selected), typing a character should be a no-op
(same semantics as having a tag "selected" — you'd delete it with Backspace/Delete, not
type through it). Currently TinyMCE routes typed characters into the entity (Bug B applies).

**Status:** not implemented. Fix for Bug B will likely also fix this: at `currentVirtualExternal
=== true`, the `beforeinput` intercept can call `preventDefault()` and return without inserting.

## Files changed

| File                                                        | Description                                     |
| ----------------------------------------------------------- | ----------------------------------------------- |
| `packages/cwrc-leafwriter/src/js/tinymce/tinymceWrapper.ts` | All navigation logic                            |
| `packages/cwrc-leafwriter/src/css/build/editor.css`         | `tag-at-boundary` and `tag-external-active` CSS |

## Deferred

- Remove `console.log` debug statements from `tinymceWrapper.ts` before merging.
- Fix Bug B (typing at external offset=0 inserts inside entity). This also covers Bug H
  (typing at pos 2 should be blocked).
- Fix Bug C (cursor exits entity after first-char deletion).
- Resolve Bug G (visual cursor ambiguity at position 3) — likely accept it unless user
  testing shows it's disruptive.
- Entity side panel does not highlight the current entity when navigating into it via keyboard
  (acceptable gap — entity was already highlighted before navigation, and doHighlightCheck is
  deliberately skipped to avoid cursor-bounce).
