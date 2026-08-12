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
// NOTES on app quirks:
//  - URLSearchParams encodes '@' in the VPA to %40; most apps decode it but BHIM
//    reads "name%40bank" literally and fails — so we build the query by hand and
//    keep '@' intact.
//  - BHIM also does NOT decode %20 in the payee name — it literally displays
//    "Bikram%20Kumar". Spaces must be sent as '+' (the standard query-string space),
//    which every UPI app decodes back to a space.
//  - BHIM is also strict about the payee name (pn) and note (tn): punctuation such
//    as ':' and other symbols make it error out ("blank"/invalid) even when GPay /
//    PhonePe accept the same link. So pn/tn are sanitized to letters, digits, and
//    spaces before encoding. pn always gets a non-empty value.
function cleanText(s, fallback) {
  const t = String(s || '')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ') // drop punctuation BHIM rejects (:, &, etc.)
    .replace(/\s+/g, ' ')
    .trim();
  return t || fallback;
}

export function buildUpiLink({ pa, pn, amount, note }) {
  if (!isValidUpi(pa)) return null;
  // Keep '@' intact (BHIM won't decode %40); send spaces as '+' (BHIM won't decode %20).
  const enc = (v) => encodeURIComponent(String(v)).replace(/%40/g, '@').replace(/%20/g, '+');
  const parts = [`pa=${enc(normalizeUpi(pa))}`, `pn=${enc(cleanText(pn, 'Payee'))}`, 'cu=INR'];
  if (amount != null && Number(amount) > 0) parts.push(`am=${Number(amount).toFixed(2)}`);
  const tn = cleanText(note, '');
  if (tn) parts.push(`tn=${enc(tn)}`);
  return 'upi://pay?' + parts.join('&');
}
