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

// Build a `upi://pay` deep link. amount is in rupees (number/string); tn = note.
// Returns null if the payee VPA is invalid (caller shows a fallback then).
export function buildUpiLink({ pa, pn, amount, note }) {
  if (!isValidUpi(pa)) return null;
  const params = new URLSearchParams();
  params.set('pa', normalizeUpi(pa));
  if (pn) params.set('pn', pn);
  if (amount != null && Number(amount) > 0) params.set('am', Number(amount).toFixed(2));
  params.set('cu', 'INR');
  if (note) params.set('tn', note);
  return 'upi://pay?' + params.toString();
}
