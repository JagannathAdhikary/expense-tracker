import { describe, it, expect } from 'vitest';
import { matchesQuery } from '../src/format.js';

describe('matchesQuery', () => {
  const personal = { desc: 'Lunch at Cafe', cat: 'Food', pay: 'UPI' };
  const shared = { desc: 'Hotel', cat: 'Travel', pay: 'Card', meta: 'Goa Trip', shared: true };

  it('matches everything when the query is empty/blank', () => {
    for (const q of ['', '   ', null, undefined]) {
      expect(matchesQuery(personal, q)).toBe(true);
    }
  });

  it('matches on the description (case-insensitive)', () => {
    expect(matchesQuery(personal, 'lunch')).toBe(true);
    expect(matchesQuery(personal, 'CAFE')).toBe(true);
    expect(matchesQuery(personal, 'dinner')).toBe(false);
  });

  it('matches on category and payment', () => {
    expect(matchesQuery(personal, 'food')).toBe(true);
    expect(matchesQuery(personal, 'upi')).toBe(true);
  });

  it('matches shared rows on the group name (meta)', () => {
    expect(matchesQuery(shared, 'goa')).toBe(true);
    expect(matchesQuery(shared, 'trip')).toBe(true);
    expect(matchesQuery(shared, 'travel')).toBe(true);
  });

  it('trims surrounding whitespace on the query', () => {
    expect(matchesQuery(personal, '  cafe  ')).toBe(true);
  });

  it('tolerates rows with missing fields', () => {
    expect(matchesQuery({}, 'x')).toBe(false);
    expect(matchesQuery({ desc: 'Only desc' }, 'only')).toBe(true);
  });
});
