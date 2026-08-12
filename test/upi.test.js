import { describe, it, expect } from 'vitest';
import { isValidUpi, normalizeUpi, buildUpiLink, dedupeUpis, withPrimary } from '../src/upi.js';

describe('isValidUpi', () => {
  it('accepts well-formed VPAs', () => {
    for (const id of ['rahul@okaxis', '9876543210@ybl', 'a.b-c_d@paytm', 'Name@OKHDFCBANK']) {
      expect(isValidUpi(id)).toBe(true);
    }
  });
  it('rejects malformed input', () => {
    for (const id of ['', 'rahul', 'rahul@', '@okaxis', 'a@b', 'rahul okaxis', 'rahul@@ok', 'ra@hul@ok', '9876543210']) {
      expect(isValidUpi(id)).toBe(false);
    }
  });
  it('is whitespace/case tolerant via normalize', () => {
    expect(isValidUpi('  Rahul@OKAxis  ')).toBe(true);
    expect(normalizeUpi('  Rahul@OKAxis ')).toBe('rahul@okaxis');
  });
});

describe('buildUpiLink', () => {
  it('builds a upi://pay link with payee, name, amount, note', () => {
    const link = buildUpiLink({ pa: 'rahul@okaxis', pn: 'Rahul', amount: 150, note: 'Trip Goa' });
    expect(link.startsWith('upi://pay?')).toBe(true);
    const q = new URLSearchParams(link.slice('upi://pay?'.length));
    expect(q.get('pa')).toBe('rahul@okaxis');
    expect(q.get('pn')).toBe('Rahul');
    expect(q.get('am')).toBe('150.00');
    expect(q.get('cu')).toBe('INR');
    expect(q.get('tn')).toBe('Trip Goa');
  });
  it('keeps @ literal in the VPA (not %40) — BHIM needs this', () => {
    const link = buildUpiLink({ pa: 'rahul@okaxis', amount: 10 });
    expect(link).toContain('pa=rahul@okaxis');
    expect(link).not.toContain('%40');
  });
  it('sanitizes pn/tn punctuation that BHIM rejects (e.g. the colon in a note)', () => {
    const q = new URLSearchParams(buildUpiLink({ pa: 'rahul@okaxis', pn: 'Rahul: K & Co.', amount: 10, note: 'Goa Trip: dinner!' }).slice('upi://pay?'.length));
    expect(q.get('pn')).toBe('Rahul K Co');
    expect(q.get('tn')).toBe('Goa Trip dinner');
  });
  it('always sends a non-empty pn (defaults to "Payee")', () => {
    const q = new URLSearchParams(buildUpiLink({ pa: 'rahul@okaxis', amount: 10 }).slice('upi://pay?'.length));
    expect(q.get('pn')).toBe('Payee');
  });
  it('formats amount to 2 decimals', () => {
    const q = new URLSearchParams(buildUpiLink({ pa: 'ab@ybl', amount: 33.3 }).slice('upi://pay?'.length));
    expect(q.get('am')).toBe('33.30');
  });
  it('omits amount when non-positive or missing', () => {
    const q = new URLSearchParams(buildUpiLink({ pa: 'ab@ybl', amount: 0 }).slice('upi://pay?'.length));
    expect(q.get('am')).toBeNull();
    expect(q.get('cu')).toBe('INR');
  });
  it('returns null for an invalid payee VPA', () => {
    expect(buildUpiLink({ pa: 'not-a-vpa', amount: 100 })).toBeNull();
    expect(buildUpiLink({ pa: '', amount: 100 })).toBeNull();
  });
  it('lowercases/trims the payee', () => {
    const q = new URLSearchParams(buildUpiLink({ pa: ' Rahul@OKAxis ', amount: 10 }).slice('upi://pay?'.length));
    expect(q.get('pa')).toBe('rahul@okaxis');
  });
});

describe('dedupeUpis', () => {
  it('normalizes, drops invalid + duplicates, preserves order', () => {
    expect(dedupeUpis([' Rahul@OKAxis ', 'ab@ybl', 'rahul@okaxis', 'nope', ''])).toEqual(['rahul@okaxis', 'ab@ybl']);
  });
  it('handles empty/nullish input', () => {
    expect(dedupeUpis()).toEqual([]);
    expect(dedupeUpis([])).toEqual([]);
    expect(dedupeUpis(['bad', 'x'])).toEqual([]);
  });
});

describe('withPrimary', () => {
  it('keeps a valid primary that is in the list', () => {
    expect(withPrimary(['aa@ybl', 'bb@okaxis'], 'bb@okaxis')).toEqual({ list: ['aa@ybl', 'bb@okaxis'], primary: 'bb@okaxis' });
  });
  it('defaults primary to the first entry when missing/invalid/absent', () => {
    expect(withPrimary(['aa@ybl', 'bb@okaxis'], '')).toEqual({ list: ['aa@ybl', 'bb@okaxis'], primary: 'aa@ybl' });
    expect(withPrimary(['aa@ybl', 'bb@okaxis'], 'cc@paytm')).toEqual({ list: ['aa@ybl', 'bb@okaxis'], primary: 'aa@ybl' });
  });
  it('returns null primary for an empty list', () => {
    expect(withPrimary([], 'aa@ybl')).toEqual({ list: [], primary: null });
  });
  it('back-compat: a single legacy upi_id seeds a one-item list', () => {
    expect(withPrimary(['rahul@okaxis'], 'rahul@okaxis')).toEqual({ list: ['rahul@okaxis'], primary: 'rahul@okaxis' });
  });
});
