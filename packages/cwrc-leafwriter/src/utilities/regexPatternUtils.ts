/** Letters, numbers, and underscore from any script — our Unicode-aware \\w. */
export const UNICODE_WORD_CLASS = '\\p{L}\\p{N}_';

const countBackslashesBefore = (pattern: string, index: number): number => {
  let count = 0;
  for (let j = index - 1; j >= 0 && pattern[j] === '\\'; j -= 1) count += 1;
  return count;
};

const isEscaped = (pattern: string, index: number): boolean =>
  countBackslashesBefore(pattern, index) % 2 === 1;

export const expandUnicodeWordShorthand = (pattern: string): string => {
  let result = '';
  let inClass = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      if (next === 'w' && isEscaped(pattern, i + 1)) {
        result += inClass ? UNICODE_WORD_CLASS : `[${UNICODE_WORD_CLASS}]`;
        i += 2;
        continue;
      }
      if (next === 'W' && isEscaped(pattern, i + 1) && !inClass) {
        result += `[^${UNICODE_WORD_CLASS}]`;
        i += 2;
        continue;
      }
    }
    if (ch === '[' && !inClass && !isEscaped(pattern, i)) inClass = true;
    else if (ch === ']' && inClass && !isEscaped(pattern, i)) inClass = false;
    result += ch;
    i += 1;
  }
  return result;
};

export const compileFindRegex = (pattern: string, ignoreCase = false): RegExp =>
  new RegExp(expandUnicodeWordShorthand(pattern), ignoreCase ? 'giu' : 'gu');

export const tryCompileFindRegex = (pattern: string, ignoreCase = false): RegExp | null => {
  try {
    return compileFindRegex(pattern, ignoreCase);
  } catch {
    return null;
  }
};

export const compileFindLiteralRegex = (query: string, ignoreCase = false): RegExp =>
  new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'giu' : 'gu');

/**
 * Shared replacement dialect: $1, \1 and #1 for capture groups, $$ for a literal dollar, and \n,
 * \t and \r for a new line, a tab and a carriage return. A backslash before anything else is kept
 * as it is, and \\ is one backslash (so \\n is the two characters \n), except before a digit,
 * where it stays a backslash followed by that group, as it always was.
 */
export const applyRegexReplacement = (match: RegExpExecArray, replacement: string): string => {
  const group = (digits: string): string => {
    const index = Number.parseInt(digits, 10);
    return index >= 1 && index < match.length ? (match[index] ?? '') : '';
  };

  let out = '';
  let i = 0;
  while (i < replacement.length) {
    const char = replacement[i]!;
    const next = replacement[i + 1];

    if (char === '\\' && next !== undefined) {
      const digits = /^[1-9]\d*/.exec(replacement.slice(i + 1))?.[0];
      if (digits) {
        out += group(digits);
        i += 1 + digits.length;
        continue;
      }
      const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\' };
      // \\1 has always meant a backslash followed by group 1: leave the second backslash to the
      // group rule on the next turn.
      if (next === '\\' && /[1-9]/.test(replacement[i + 2] ?? '')) {
        out += '\\';
        i += 1;
        continue;
      }
      const escaped = escapes[next];
      if (escaped !== undefined) {
        out += escaped;
        i += 2;
        continue;
      }
    } else if (char === '#') {
      const digits = /^#([1-9]\d*)/.exec(replacement.slice(i))?.[1];
      if (digits) {
        out += group(digits);
        i += 1 + digits.length;
        continue;
      }
    } else if (char === '$') {
      const token = /^\$(\$|\d+)/.exec(replacement.slice(i))?.[1];
      if (token !== undefined) {
        out += token === '$' ? '$' : group(token);
        i += 1 + token.length;
        continue;
      }
    }

    out += char;
    i += 1;
  }
  return out;
};
