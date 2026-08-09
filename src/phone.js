// Phone-number helpers — pure, unit-testable. Format validation only (we don't
// OTP-verify). Targets Indian mobiles primarily but accepts an optional country
// code so it isn't India-only.

// Strip spaces, dashes, parens for validation/storage.
export function normalizePhone(raw) {
  return (raw || '').replace(/[\s\-()]/g, '').trim();
}

// Valid when it's a 10-digit Indian mobile (starting 6-9), optionally prefixed
// with +91 / 91 / 0, OR a general +<country><number> of 8–15 digits.
export function isValidPhone(raw) {
  const p = normalizePhone(raw);
  if (/^(?:\+91|91|0)?[6-9]\d{9}$/.test(p)) return true; // Indian mobile
  if (/^\+\d{8,15}$/.test(p)) return true; // international E.164-ish
  return false;
}

// Canonical display/storage form: Indian numbers -> +91XXXXXXXXXX; others kept as
// entered (normalized). Returns '' for empty input.
export function formatPhone(raw) {
  const p = normalizePhone(raw);
  if (!p) return '';
  const m = p.match(/^(?:\+91|91|0)?([6-9]\d{9})$/);
  if (m) return '+91' + m[1];
  return p;
}
