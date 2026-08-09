import { describe, it, expect } from 'vitest';
import { isValidUpi, normalizeUpi, buildUpiLink } from '../src/upi.js';

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
