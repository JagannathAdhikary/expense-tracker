// Friend search — pure, unit-testable. Given a candidate list of {id,name,phone}
// and a query, return matches. Name matches on a case-insensitive substring; a
// query of 10+ digits matches on the last 10 digits of the phone (so +91 / spaces
// in stored numbers don't block a plain 10-digit search).

const digits = (s) => (s || '').replace(/\D/g, '');

export function matchFriends(candidates, query) {
  const q = (query || '').trim();
  if (!q) return [];
  const qDigits = digits(q);
  // Phone search kicks in once 10+ digits are entered.
  if (qDigits.length >= 10) {
    const last10 = qDigits.slice(-10);
    return candidates.filter((c) => digits(c.phone).slice(-10) === last10);
  }
  const lower = q.toLowerCase();
  return candidates.filter((c) => (c.name || '').toLowerCase().includes(lower));
}
