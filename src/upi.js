// UPI helpers — pure, unit-testable. No DOM, no Supabase.
//
// A UPI ID (VPA) looks like `name@provider`, e.g. rahul@okaxis, 9876543210@ybl.
// We can only validate FORMAT here — a PWA can't verify the VPA actually exists
// or resolve the account holder's name (only the UPI app / a licensed PSP can).

// Local part: letters/digits and . _ - (2+ chars). Provider: starts with a letter,
// letters/digits/.-_ (2+ chars). Deliberately strict enough to catch typos, loose
// enough to accept all real bank/PSP handles.
const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,}@[a-zA-Z][a-zA-Z0-9.\-_]{1,}$/;

// Normalize (trim; UPI IDs are case-insensitive, lowercased by convention).
export function normalizeUpi(id) {
  return (id || '').trim().toLowerCase();
}

// True when `id` is a well-formed VPA (format only).
export function isValidUpi(id) {
  const v = normalizeUpi(id);
  return VPA_RE.test(v);
}

// Normalize, validate, and de-duplicate a list of VPAs, preserving first-seen order.
// Drops blanks, malformed handles, and repeats. Returns a fresh array.
export function dedupeUpis(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const v = normalizeUpi(raw);
    if (!isValidUpi(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// Given a (raw) list and a desired primary, return a cleaned `{ list, primary }`.
// The list is deduped; primary is normalized and, if missing/invalid/absent from the
// list, falls back to the first entry (or null when the list is empty).
export function withPrimary(list, primary) {
  const clean = dedupeUpis(list);
  const p = normalizeUpi(primary);
  const chosen = p && clean.includes(p) ? p : clean[0] || null;
  return { list: clean, primary: chosen };
}

// Build a `upi://pay` deep link. amount is in rupees (number/string); tn = note.
// Returns null if the payee VPA is invalid (caller shows a fallback then).
//
// NOTE: we build the query string by hand rather than with URLSearchParams,
// because URLSearchParams percent-encodes '@' in the VPA to %40. Most UPI apps
// decode that, but BHIM does NOT — it reads "name%40bank" literally and fails.
// The payee address (pa) is passed with its '@' intact; other values are encoded
// but with '@' preserved for safety.
export function buildUpiLink({ pa, pn, amount, note }) {
  if (!isValidUpi(pa)) return null;
  const enc = (v) => encodeURIComponent(String(v)).replace(/%40/g, '@');
  const parts = [`pa=${enc(normalizeUpi(pa))}`, 'cu=INR'];
  if (pn) parts.push(`pn=${enc(pn)}`);
  if (amount != null && Number(amount) > 0) parts.push(`am=${Number(amount).toFixed(2)}`);
  if (note) parts.push(`tn=${enc(note)}`);
  return 'upi://pay?' + parts.join('&');
}
