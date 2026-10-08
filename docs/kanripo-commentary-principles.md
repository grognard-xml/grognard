# Kanripo commentary — principles for import and parallel transfer

**Status (2026-10-08):** Agreed principle; implemented in `plugins/packages/plugin-kanripo-import` (`parallel_punct.py`, `kanripo_tei.py`). Written down so later changes (new parallel sources, new texts, new conditional rules) follow it.
**Related:** [kanripo-import-plugin-planning.md](kanripo-import-plugin-planning.md), [wikisource-import.md](wikisource-import.md), the plugin README (section _Edition-tolerant alignment_).

---

## 1. The rule

**What Kanripo (KRP) marks as interlinear commentary is final.**

In KRP, `(…)` marks small double-line print (雙行小字). KRP is very consistent and accurate about this, much more so than other corpora, so the importer turns every such span into `<note type="comm">` and nothing downstream may overrule it.

A KRP-marked note keeps, exactly as KRP has it:

- its **type** (`comm`; no later step retypes it, for example to a "sub-commentary" type),
- its **position** in the text,
- its **content** (no step moves text into or out of it).

Anything beyond that is allowed **only to add**:

- act on text KRP leaves **unmarked** (plain text), or
- add information that does not change what KRP identified (for example an additional `@subtype` on a note, never a different `@type`).

A parallel source (Wikisource, Daozang, ctext, a pasted file) supplies **punctuation, paragraph breaks and, where KRP is silent, commentary boundaries**. It never reclassifies what KRP has marked.

## 2. How the code follows it

| Step                                              | What it does                                                                                                                                                  | Why it respects the rule                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Import conversion (`kanripo_tei.body_to_tei_div`) | `(…)` → `<note type="comm">`; a line-final `¶` inside an open note does not end the paragraph                                                                 | The note is exactly KRP's span.                                                |
| Mark transfer                                     | Inserts punctuation inside body text and inside KRP's notes                                                                                                   | Adds marks; never changes a note's type or extent.                             |
| Paragraph transfer                                | Adds the parallel's paragraph breaks; a break that falls inside a note moves to where the note closes, and only when base text follows                        | A note is never split, and no paragraph opens with a note.                     |
| Commentary wrapping (`_wrap_paren_commentary`)    | Wraps **plain** body text that aligns to parenthesised parallel text (`（…）`, `(…)`, Wikisource `〈…〉`, ctext inline-comment spans) in `<note type="comm">` | Acts only on text KRP left unmarked; skips anything already in a note or head. |
| Joining wrapped fragments                         | A gloss that runs over a Kanripo print-line wrap is wrapped once per line; the pieces are joined back into one note                                           | Joins only fragments the wrapper itself created (see §4).                      |

Not touched by any of this: the literal label characters (注 / 音義 / 疏) that KRP writes in front of a note stay base text outside it, as KRP has them, even where the transcriber mislabelled (e.g. `注(…)` before what is really 疏).

## 3. Worked example: 爾雅注疏 (KR1j0004)

KRP marks 音義 and 疏 as `(…)` small print and leaves 注 as plain text. Wikisource's 註疏 sets 注 in `（…）` and 疏 as ordinary paragraphs. Applying the rule:

- 音義 and 疏 stay `<note type="comm">`, as KRP marks them. The disagreement with Wikisource (which treats 疏 as a normal paragraph) does **not** change them.
- 注 was plain text in KRP, so it may be wrapped, because Wikisource brackets it: `注<note type="comm">…</note>`.
- A 注 that Wikisource leaves unbracketed (some pages, e.g. 卷01) stays plain text: there is no evidence to add a note.

## 4. Checks to keep when changing the code

- A transfer never removes, retypes or resizes a KRP note. The join that repairs a wrapped gloss must be limited to notes the wrapper created, not notes KRP separated.
- Output Han must equal input Han apart from the import's normalisation option; run a diff against the raw Kanripo text after any change to the byte or text path.
- A conditional rule must be justified by something explicit in the sources, not by a guess about what a label or an indent "usually" means.

## 5. Indentation and other conditional rules (not built)

Some KRP texts separate levels of commentary by **indentation** rather than parentheses, and what the indentation means differs from text to text. A rule for that is defensible **only** under §1: it may classify text KRP left unmarked, and it must never undo what KRP marked as interlinear.

Not built yet, for two reasons:

1. The importer currently discards leading indentation (U+3000), except to detect the Siku title block, so a rule would first need it preserved.
2. There is no concrete text to test against. Add the rule when the first such text appears, with that text as the regression case.

Existing conditional logic, for reference: `strip_shu_citations` only acts on a Wikisource text that has at least three 十三經註疏-style header paragraphs, and it edits the _parallel_ text, never the KRP body.

## 6. Known, deliberate limits

- ~100 short 注 in 爾雅注疏 stay plain text because the Wikisource page itself does not bracket them.
- 音義 notes mostly stay unpunctuated by the transfer (Wikisource's 註疏 has no 音義 text); they are for AI fill.
- Character normalisation (DPM variant table) is a separate import option; it currently emits some compatibility-block ideographs (e.g. 請, 靖) and is not part of this principle.
