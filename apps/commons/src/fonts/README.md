# Bundled fonts

`BabelStoneHan.woff2` is BabelStone Han 16.0.3 (January 1, 2025) by Andrew West
(https://www.babelstone.co.uk/Fonts/), derived in part from Arphic Technology's AR PL fonts. It
is the complete font, converted from TrueType to WOFF2 (lossless, no glyphs or tables removed). It
covers the CJK Unified Ideographs and Extensions A to I, so every character the editor handles
draws the same on every machine.

It is licensed under the Arphic Public License (see `BabelStoneHan-ARPHIC-PUBLIC-LICENSE.txt`,
also embedded in the font's name table). The original font is available from the URL above.

It is declared as `Grognard Han` and is the **first** family in the interface, Visual editor and
Source editor font stacks. The `unicode-range` in `han.css` limits it to ideographs, radicals,
ideographic description characters and variation selectors, so Latin, kana, Hangul and punctuation
keep using the other fonts. The Tibetan editor font stack is unchanged.

The file is 9.4 MB and is fetched and decoded the first time Han text is drawn (about 1.7 s on a
fast Mac); `font-display: swap` shows the text in a fallback font until it is ready.
