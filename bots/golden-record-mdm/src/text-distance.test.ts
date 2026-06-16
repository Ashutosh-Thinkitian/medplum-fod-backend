import { describe, expect, test } from 'vitest';
import { damerauLevenshtein, normalizeName, soundex } from './text-distance';

describe('normalizeName', () => {
  test('lowercases, trims, strips diacritics', () => {
    expect(normalizeName('  José ')).toBe('jose');
    expect(normalizeName('GARCIA')).toBe('garcia');
  });
});

describe('damerauLevenshtein', () => {
  test('identical = 0', () => expect(damerauLevenshtein('garcia', 'garcia')).toBe(0));
  test('substitution = 1 (Garcis)', () => expect(damerauLevenshtein('garcis', 'garcia')).toBe(1));
  test('deletion = 1 (Garca)', () => expect(damerauLevenshtein('garca', 'garcia')).toBe(1));
  test('transposition = 1 (Gracia)', () => expect(damerauLevenshtein('gracia', 'garcia')).toBe(1));
  test('garbage is large', () => expect(damerauLevenshtein('zzzzzz', 'garcia')).toBe(6));
});

describe('soundex', () => {
  test('Garcia = G620', () => expect(soundex('Garcia')).toBe('G620'));
  test('Garsia = G620 (phonetic match)', () => expect(soundex('Garsia')).toBe('G620'));
  test('Garca = G620', () => expect(soundex('Garca')).toBe('G620'));
  test('Zzzzzz != G620', () => expect(soundex('Zzzzzz')).not.toBe('G620'));
  test('Ashcraft = A261 (H is transparent between same-coded letters)', () => expect(soundex('Ashcraft')).toBe('A261'));
  test('Jackson = J250 (vowel separates same-coded consonants)', () => expect(soundex('Jackson')).toBe('J250'));
  test('Pfister = P236', () => expect(soundex('Pfister')).toBe('P236'));
  test('empty input returns empty string', () => expect(soundex('')).toBe(''));
});
