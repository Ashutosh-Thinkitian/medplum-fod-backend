// SPDX-License-Identifier: Apache-2.0
// Self-contained text-distance primitives (no external deps — runs in Medplum vmcontext).

/** Lowercase, trim, strip combining diacritics (NFD decomposition, then drop U+0300–U+036F). */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Optimal String Alignment (OSA) distance — Levenshtein extended with adjacent transpositions.
 * Equivalent to Damerau-Levenshtein for all single-operation edits and typical name typos.
 * Note: unlike full Damerau-Levenshtein, a substring may not be edited more than once
 * (e.g. "ca" -> "abc" = 3, not 2). The function name is kept for call-site familiarity.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[al][bl];
}

/**
 * American Soundex (4-char code: letter + 3 digits).
 * Returns empty string for empty/non-alpha input.
 * Delegates lowercase/trim/diacritic-strip normalization to {@link normalizeName}.
 *
 * Coding table:
 *   1 → B F P V
 *   2 → C G J K Q S X Z
 *   3 → D T
 *   4 → L
 *   5 → M N
 *   6 → R
 *   (H W are ignored; A E I O U Y are vowels — coded 0, suppress adjacent duplicates)
 *
 * Rules:
 *   1. Retain first letter (uppercased).
 *   2. Replace all consonants (including first letter) with digits.
 *   3. If two adjacent letters have the same Soundex code, only retain one digit.
 *      H and W are transparent (they do NOT break adjacency).
 *   4. Remove all vowels (A E I O U Y).
 *   5. Pad with zeros or truncate to exactly 4 characters.
 */
export function soundex(input: string): string {
  const s = normalizeName(input).replace(/[^a-z]/g, '');
  if (!s) return '';

  const codes: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  };

  const first = s[0].toUpperCase();
  // prev tracks the code of the last significant consonant processed;
  // h/w are transparent so they do not update prev.
  let prev = codes[s[0]] ?? '0';
  let out = first;

  for (let i = 1; i < s.length && out.length < 4; i++) {
    const ch = s[i];
    const code = codes[ch] ?? '0';

    if (ch === 'h' || ch === 'w') {
      // transparent — skip without updating prev
      continue;
    }

    if (code !== '0' && code !== prev) {
      out += code;
    }

    prev = code;
  }

  return (out + '000').slice(0, 4);
}
