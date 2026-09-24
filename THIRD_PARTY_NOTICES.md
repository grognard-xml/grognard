# Third-Party Notices

Leaf Writer and the Grognard desktop shell include third-party software that keeps its own upstream license terms. This file is a practical pointer to the major runtime dependencies we bundle or rely on directly.

When shipping releases, keep this document in sync with the actual dependency set in `package.json` and the generated lockfile. Transitive dependencies are covered by their own upstream licenses through the npm dependency tree.

## Major runtime components

- `TinyMCE` - rich-text editor used in the main editing surface, heavily
  customized. Dual-licensed by Tiny Technologies under (1) GNU GPL v2 or
  later, or (2) Tiny's commercial Self-Hosted License Agreement — see
  `node_modules/tinymce/license.md`. This project uses the GPL branch: the
  editor is initialized with `license_key: 'gpl'` (see
  `packages/cwrc-leafwriter/src/js/tinymce/tinymceWrapper.ts`), not a Tiny
  Cloud API key. TinyMCE's license permits "or later" GPL versions, so it
  combines cleanly with this repository's `AGPL-3.0-only` licensing.
- `monaco-editor` - code editor used for source-oriented editing views. MIT
  licensed; also covers the bundled `codicon.ttf` icon font shipped at
  `apps/commons/public/fonts/codicon.ttf` — full text copied to
  `apps/commons/public/fonts/LICENSE-codicon-monaco.txt`.
- `Electron` - desktop shell runtime for the packaged app. MIT licensed.
- `jszip` - archive handling used by import/export workflows. Dual licensed,
  `MIT OR GPL-3.0-or-later`.
- `mammoth` - Word document conversion support in the desktop app.
  BSD-2-Clause licensed.
- `@xmldom/xmldom` - XML DOM implementation used by the desktop app. MIT
  licensed.
- `Font Awesome Free` - icon font used in the editing UI. Icons are CC BY
  4.0, fonts are SIL OFL 1.1, code is MIT. Full license text copied to
  `apps/commons/public/fonts/LICENSE-fontawesome.txt` alongside the bundled
  `fa-regular-400.woff2` / `fa-solid-900.woff2` files.
- `Lato` - UI typeface, bundled as static `.woff`/`.woff2` files under
  `apps/commons/public/fonts/`. SIL Open Font License 1.1; full text copied
  to `apps/commons/public/fonts/OFL-1.1-lato.txt`.
- `@kurgm/kage-engine` - renders KAGE-format glyph data (the format used by
  GlyphWiki) to SVG, used by the CHHIV glyph composer to draw locally-composed
  unencoded characters. GPL-3.0 licensed; combined into this AGPL-3.0-only
  program under each license's section 13 (the "Remote Network Interaction"
  compatibility clause both licenses carry, added specifically to permit
  this combination).
- **GlyphWiki KAGE core data** (`packages/cwrc-leafwriter/src/resources/glyphwiki/kageCore.json`)
  - a filtered, dependency-closed subset of GlyphWiki's public dump (canonical
    `u<hex>`-named entries plus every component they reference), bundled so the
    glyph composer can draw ordinary Unicode characters as components offline.
    Per GlyphWiki's own dump license (copied to
    `packages/cwrc-leafwriter/src/resources/glyphwiki/LICENSE.txt`): free to
    use, copy, and distribute, with or without modification, commercially or
    not, no attribution required. Copyright 2009 GlyphWiki Project.
- `Noto Sans` - pre-rendered glyph tiles (SDF/PBF) for map-label rendering,
  bundled under `apps/commons/public/fonts/Noto Sans {Regular,Medium,Italic}/`.
  SIL Open Font License 1.1; full text copied to `OFL-1.1-noto-sans.txt` in
  each of those directories.

## Creative assets

- **Adventurer character art** — the player-avatar layers used in the
  achievement/game system are based on
  [Adventurer](https://www.figma.com/community/file/1184595184137881796) by
  **Lisa Wischofsky** ([@lischi_art](https://www.instagram.com/lischi_art/)),
  distributed via [DiceBear](https://www.dicebear.com/styles/adventurer) and
  licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Assets have
  been split into individual layers and, in some cases, recolored — see
  the private `visual_design/visual_style` source repo for the full
  attribution notice and list of modifications.
- **Sanmiao** — Chinese, Japanese, and Korean historical calendar
  conversion, by Daniel Patrick Morgan (CNRS-CRCAO), bundled as the desktop
  app's date-conversion back end. MIT licensed.

## Repository licenses

- The repository itself is licensed under `AGPL-3.0-only` (see `LICENSE`), inherited from LEAF-Writer. AGPL section 13 (source offer to remote network users) applies to any networked component that is deployed and serves remote users — notably `workers/entity-sync/` — not to normal single-user desktop use.
- Individual upstream dependencies may use different licenses. Their exact terms should be taken from the package metadata that ships with each dependency version.

## Where to verify

- Root workspace dependencies: `/Users/daniel/Code/leaf-writer/package.json`
- Desktop app dependencies: `/Users/daniel/Code/leaf-writer/apps/desktop/package.json`
- Core editor dependencies: `/Users/daniel/Code/leaf-writer/packages/cwrc-leafwriter/package.json`
- Generated dependency tree: `/Users/daniel/Code/leaf-writer/package-lock.json`

If you add a new runtime dependency, please update this file and any release packaging steps so the license notice travels with the app.
