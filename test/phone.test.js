import { describe, it, expect } from 'vitest';
import { isValidPhone, normalizePhone, formatPhone } from '../src/phone.js';

describe('isValidPhone', () => {
  it('accepts Indian mobiles with/without prefixes', () => {
    for (const p of ['9876543210', '+919876543210', '919876543210', '09876543210', '+91 98765 43210', '98765-43210']) {
      expect(isValidPhone(p)).toBe(true);
    }
  });
  it('accepts international E.164-ish numbers', () => {
    expect(isValidPhone('+14155552671')).toBe(true);
    expect(isValidPhone('+442071838750')).toBe(true);
  });
  it('rejects junk / wrong length / bad leading digit', () => {
    for (const p of ['', '12345', '1234567890', '98765', 'abcdefghij', '+91123', '5876543210']) {
      expect(isValidPhone(p)).toBe(false); // 1234567890 & 5.. start with <6 -> invalid Indian
    }
  });
});

describe('normalizePhone', () => {
  it('strips spaces, dashes, parens', () => {
    expect(normalizePhone(' +91 (98765)-43210 ')).toBe('+919876543210');
  });
});

describe('formatPhone', () => {
  it('canonicalizes Indian numbers to +91XXXXXXXXXX', () => {
    expect(formatPhone('9876543210')).toBe('+919876543210');
    expect(formatPhone('09876543210')).toBe('+919876543210');
    expect(formatPhone('+91 98765 43210')).toBe('+919876543210');
  });
  it('keeps international numbers as normalized', () => {
    expect(formatPhone('+1 415 555 2671')).toBe('+14155552671');
  });
  it('returns empty for empty input', () => {
    expect(formatPhone('')).toBe('');
  });
});
