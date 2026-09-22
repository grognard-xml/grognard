/**
 * In-app procedural translations for place-name + geo-admin suffix office
 * compounds (e.g. 枝江令, 豫章太守, 豫州刺史). These follow a fixed template
 * using a suffix gloss, so no pack lookup or LLM call is needed.
 *
 * Ported from the offline Huckbot5000 script
 * (`authoritypacks/huckbot5000/proceduralPlaceSuffix.mjs`) so the same
 * pattern applies live when a user tags a roleName the offline packs never
 * covered. Disambiguation stays conservative: institutional titles that
 * merely end in 令 (尚書令, 黃門令, …) are excluded via blocklists and stem
 * heuristics — when in doubt, this returns null and the office falls back to
 * whatever gloss (or none) the packs already provide.
 *
 * Place stems are rendered as concatenated toneless pinyin (遼東 → Liaodong),
 * matching leaf-writer's place romanization style.
 */
import { pinyin } from 'pinyin-pro';

const CJK_ONLY = /^[一-鿿]+$/;

/** Full office names that end in 令 but are not place+suffix compounds. */
const FIXED_LING_OFFICES = new Set([
  '尚書令',
  '中書令',
  '太子家令',
  '太子率更令',
  '郎中令',
  '內史令',
  '太史令',
  '縣令',
  '黃門令',
  '宦者令',
  '家令',
  '太樂令',
  '郞中令',
  '門下令',
  '太官令',
  '公主家令',
  '廐牧令',
  '內謁者令',
  '率更令',
  '太子廐牧令',
  '行臺尚書令',
]);

/**
 * Non-place prefix modifiers that change the office itself (督太守, 知刺史, …).
 * Note: 同 is NOT here — 同州 / 同安 are real place names.
 */
const PREFIX_MODIFIER = /^(督|都|部|知|行|攝|假|副|領|總)/;

/**
 * Known false positives: look like place+suffix but aren't clean geographic
 * stems. Left ungenerated rather than inventing a place name.
 */
const PROCEDURAL_BLOCKLIST = new Set([
  '遷安固太守', // appointment verb 遷 + 安固太守, not a place 遷安固
]);

/** Institutional stems — not geographic place names. */
const REJECT_STEM_PREFIX =
  /^(太子|公主|內謁|率更|廐牧|尚書|中書|郎中|內史|太史|太樂|太官|門下|黃門|宦者|車府|承華|騎馬|家馬|譯官|郞中|柱下|符節|鐘官|中壘|中散|駿馬|學官|諸冶|中準|五岳|四瀆|皇后|奉慈|陵臺|知園|內府|掖庭|宮闈|奚官|尚食|尚醫|尚衣|尚冠|尚席|尚輦|尚浴|尚寢|尚功|行臺|總管)/;

/** Characters that rarely appear inside a bare geographic stem. */
const INSTITUTIONAL_IN_STEM = /[官署府院局司監寺廟臺坊闈樂衛書尉門藏犧社]/;

/**
 * Dynasty / regime names glued onto a place stem (北魏華山太守, 東魏令).
 * Reject the whole compound rather than inventing "Beiweihuashan".
 */
const DYNASTY_IN_STEM =
  /^(北魏|東魏|西魏|北齊|北周|南齊|劉宋|蕭梁|東晉|西晉|前秦|後秦|后秦|前燕|後燕|后燕|前涼|北涼|西涼|南涼|成漢|胡夏|曹魏|孫吳|蜀漢)/;

/** Another office title embedded in the stem (郡守刺史, …). */
const OFFICE_IN_STEM = /郡守|縣令|太守|刺史|縣長|郡丞/;

export const GEO_ADMIN_SUFFIXES = ['縣令', '郡太守', '太守', '刺史', '令'] as const;
export type GeoAdminSuffix = (typeof GEO_ADMIN_SUFFIXES)[number];

/** Default suffix gloss when no dynasty-specific override is known. */
export const DEFAULT_SUFFIX_GLOSS: Record<GeoAdminSuffix, string> = {
  縣令: 'District Magistrate',
  郡太守: 'Commandery Governor',
  太守: 'Commandery Governor',
  刺史: 'Regional Inspector',
  令: 'District Magistrate',
};

/** French counterpart. No offline procedural precedent exists for MaxiRicci7000 yet. */
export const DEFAULT_SUFFIX_GLOSS_FR: Record<GeoAdminSuffix, string> = {
  縣令: 'magistrat de district',
  郡太守: 'gouverneur de commanderie',
  太守: 'gouverneur de commanderie',
  刺史: 'inspecteur régional',
  令: 'magistrat de district',
};

const STEM_LENGTH: Record<GeoAdminSuffix, { min: number; max: number }> = {
  // X縣令 / X郡太守 — one-character place stems are real (上縣, 陳郡, …)
  縣令: { min: 1, max: 4 },
  郡太守: { min: 1, max: 4 },
  太守: { min: 2, max: 4 },
  // X州刺史 needs room for 南寧州 / 青冀二州
  刺史: { min: 2, max: 5 },
  令: { min: 2, max: 3 },
};

/** Concatenated toneless pinyin with initial capital (遼東 → Liaodong). */
export function romanizePlaceStem(zh: string): string | null {
  const syllables = pinyin(zh, { toneType: 'none', type: 'array' })
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!syllables.length) return null;
  const joined = syllables.join('');
  // Allow ü (lü, nü, …) — that is correct pinyin, not ASCII "v".
  if (!/^[a-zA-ZüÜ]+$/.test(joined)) return null;
  return joined[0].toUpperCase() + joined.slice(1).toLowerCase();
}

/**
 * Admin-unit character at the end of a place stem.
 * 刺史 compounds normally end in 州 (豫州刺史); short 令 must not end in
 * 國郡州縣. Compound 縣令 / 郡太守 only reject a doubled unit. Bare 太守
 * accepts 州/國 stems (冀州太守, 襄國太守).
 */
function stemEndsWithBannedAdminUnit(stem: string, suffix: GeoAdminSuffix): boolean {
  if (suffix === '刺史') return /[國郡縣]$/.test(stem);
  if (suffix === '縣令') return /縣$/.test(stem);
  if (suffix === '郡太守') return /郡$/.test(stem);
  if (suffix === '太守') return /縣$/.test(stem);
  return /[國郡州縣]$/.test(stem);
}

export interface ParsedGeoAdminCompound {
  stem: string;
  suffix: GeoAdminSuffix;
}

export function parseGeoAdminCompound(zh: string): ParsedGeoAdminCompound | null {
  const name = String(zh ?? '')
    .normalize('NFKC')
    .trim();
  if (!name) return null;
  if (PROCEDURAL_BLOCKLIST.has(name)) return null;

  for (const suffix of GEO_ADMIN_SUFFIXES) {
    if (!name.endsWith(suffix) || name.length <= suffix.length) continue;
    const stem = name.slice(0, -suffix.length);
    const bounds = STEM_LENGTH[suffix];
    if (stem.length < bounds.min || stem.length > bounds.max) continue;
    if (!CJK_ONLY.test(stem)) continue;
    if (suffix === '令' && FIXED_LING_OFFICES.has(name)) continue;
    if (PREFIX_MODIFIER.test(name)) continue;
    if (REJECT_STEM_PREFIX.test(stem)) continue;
    // 縣令 / 郡太守 / 太守 are geo-admin titles; place stems routinely contain
    // 門/臺/衛/樂/尉 (雁門, 樂浪, 五臺, …). Keep the institutional-char filter
    // only for short 令 / 刺史 (黃門令, …).
    if (
      suffix !== '縣令' &&
      suffix !== '郡太守' &&
      suffix !== '太守' &&
      INSTITUTIONAL_IN_STEM.test(stem)
    ) {
      continue;
    }
    if (stemEndsWithBannedAdminUnit(stem, suffix)) continue;
    if (DYNASTY_IN_STEM.test(stem)) continue;
    if (/[左右]$/.test(stem)) continue;
    if (OFFICE_IN_STEM.test(stem)) continue;
    return { stem, suffix };
  }
  return null;
}

export interface ProceduralOfficeGloss {
  en: string;
  fr: string;
  stem: string;
  suffix: GeoAdminSuffix;
  placeRomanization: string;
}

/**
 * Try the place+suffix template against a roleName. Returns null when the
 * name doesn't match the pattern, or the place stem can't be romanized.
 */
export function tryProceduralOfficeTranslation(zh: string): ProceduralOfficeGloss | null {
  const parsed = parseGeoAdminCompound(zh);
  if (!parsed) return null;
  const placeRomanization = romanizePlaceStem(parsed.stem);
  if (!placeRomanization) return null;
  return {
    en: `${DEFAULT_SUFFIX_GLOSS[parsed.suffix]} of ${placeRomanization}`,
    fr: `${DEFAULT_SUFFIX_GLOSS_FR[parsed.suffix]} de ${placeRomanization}`,
    stem: parsed.stem,
    suffix: parsed.suffix,
    placeRomanization,
  };
}
