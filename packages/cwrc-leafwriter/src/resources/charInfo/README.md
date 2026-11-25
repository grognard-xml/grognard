# Character info (display metadata)

Rich per-character facts for the CHHIV Compose dialog (marinaMoji parity):
strokes, pinyin, Japanese readings, radical–stroke, English gloss, variants,
旧字体/新字体, regional / IVS form notes.

**Not** for drawing (that is GlyphWiki / KAGE) or IDS lookup (that is
`../ids/`).

## Files

| File                                       | Role                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `../../../data-src/charInfo/char_info.tsv` | Source table (same schema as marinaMoji); kept outside `src/` so it is not bundled |
| `charInfoIndex.json`                       | Runtime lookup (`char` → fields), built from the TSV                               |
| `UNICODE_NOTICE.txt`                       | Unicode Terms of Use for Unihan-derived data                                       |

## Licence

Built from Unicode Unihan (and further variant sources documented in
marinaMoji’s `src/data/character_info/README.md`). Redistribution must keep
`UNICODE_NOTICE.txt` with the data. Rebuild from Unihan with marinaMoji’s
`build_char_info.py`, then regenerate the JSON:

```bash
node -e "
const fs=require('fs');
const COLS=['char','cp','strokes','pinyin','ja_on','ja_kun','rs','definition','variants','ja_kana','old_form','new_form','region_forms','ivs_forms'];
const index={};
for (const line of fs.readFileSync('../../../data-src/charInfo/char_info.tsv','utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const p=line.split('\t');
  const row={}; for (let i=1;i<COLS.length;i++) if (p[i]) row[COLS[i]]=p[i];
  index[p[0]]=row;
}
fs.writeFileSync('charInfoIndex.json', JSON.stringify(index));
"
```
