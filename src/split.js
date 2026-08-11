// Pure split math — no DOM, no Supabase, no side effects. Unit-testable.
//
// Money is handled in integer paise internally to avoid floating-point drift,
// then returned as rupee numbers with 2-decimal precision. computeSplits always
// returns shares that sum EXACTLY to the input amount; any rounding remainder is
// assigned to the payer (or the first member if no payer is given).

const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const toRupees = (paise) => paise / 100;

/**
 * Compute each member's share of an amount.
 *
 * @param {object} p
 * @param {number} p.amount           total amount in rupees
 * @param {string[]} p.members        member user ids (order matters for remainder)
 * @param {string} [p.mode]           'equal' | 'amount' | 'percent'
 * @param {Object<string,number>} [p.weights]  for 'amount': rupee per member;
 *                                              for 'percent': percentage per member
 * @param {string} [p.payerId]        member who absorbs the rounding remainder
 * @returns {Array<{userId:string, share:number}>} shares summing exactly to amount
 */
export function computeSplits({ amount, members, mode = 'equal', weights = {}, payerId = null }) {
  const total = toPaise(amount);
  if (!members || members.length === 0) return [];

  const remainderHolder = payerId && members.includes(payerId) ? payerId : members[0];
  let shares; // paise per member, keyed by userId

  if (mode === 'equal') {
    const base = Math.floor(total / members.length);
    shares = Object.fromEntries(members.map((m) => [m, base]));
    // Distribute the leftover paise one-by-one, starting at the remainder holder.
    let leftover = total - base * members.length;
    const order = [remainderHolder, ...members.filter((m) => m !== remainderHolder)];
    let i = 0;
    while (leftover > 0) {
      shares[order[i % order.length]] += 1;
      leftover -= 1;
      i += 1;
    }
  } else if (mode === 'amount') {
    // Explicit rupee amounts per member; remainder holder absorbs any mismatch.
    shares = Object.fromEntries(members.map((m) => [m, toPaise(weights[m] || 0)]));
    const sum = members.reduce((s, m) => s + shares[m], 0);
    shares[remainderHolder] += total - sum;
  } else if (mode === 'percent') {
    // Percentages per member (should sum to ~100); scale to the total, fix remainder.
    let assigned = 0;
    shares = {};
    members.forEach((m) => {
      const pct = Number(weights[m] || 0);
      const v = Math.floor((total * pct) / 100);
      shares[m] = v;
      assigned += v;
    });
    shares[remainderHolder] += total - assigned;
  } else if (mode === 'shares') {
    // Ratio shares per member: member's cut = weight / sum(weights) × total.
    // e.g. A=2, B=3 -> A gets 2/5, B gets 3/5. Remainder holder absorbs rounding.
    // If no weights given, falls back to an even split.
    const totalShares = members.reduce((s, m) => s + Math.max(0, Number(weights[m] || 0)), 0);
    shares = {};
    let assigned = 0;
    if (totalShares > 0) {
      members.forEach((m) => {
        const w = Math.max(0, Number(weights[m] || 0));
        const v = Math.floor((total * w) / totalShares);
        shares[m] = v;
        assigned += v;
      });
    } else {
      const base = Math.floor(total / members.length);
      members.forEach((m) => {
        shares[m] = base;
        assigned += base;
      });
    }
    shares[remainderHolder] += total - assigned;
  } else {
    throw new Error(`Unknown split mode: ${mode}`);
  }

  return members.map((m) => ({ userId: m, share: toRupees(shares[m]) }));
}

/**
 * A user's effective ("fair share") spend given group expenses and their splits.
 *
 * The rule from the worked example: a payer initially carries the full amount, but
 * once other members settle their shares the payer is reimbursed down to their own
 * share; a debtor owes (negative/pending) until they mark done, after which the
 * share counts as their real spend.
 *
 * effective(user) =
 *     sum over expenses they PAID of (their own share)              // what they truly spent
 *   + sum over expenses they paid of (unsettled others' shares)     // still fronting this money
 *   + sum of THEIR shares in others' expenses that are 'done'       // settled debts they truly owe
 *
 * @param {Array} expenses  group_expenses rows ({id, payer_id})
 * @param {Array} splits    expense_splits rows ({expense_id, debtor_id, share_amount, status})
 * @param {string} userId
 * @returns {number} effective spend in rupees
 */
export function netForUser(expenses, splits, userId) {
  const splitsByExpense = new Map();
  for (const s of splits) {
    if (!splitsByExpense.has(s.expense_id)) splitsByExpense.set(s.expense_id, []);
    splitsByExpense.get(s.expense_id).push(s);
  }

  let paise = 0;
  for (const exp of expenses) {
    const rows = splitsByExpense.get(exp.id) || [];
    if (exp.payer_id === userId) {
      // Own share always counts; others' shares still count until they settle.
      for (const s of rows) {
        if (s.debtor_id === userId) paise += toPaise(s.share_amount);
        else if (s.status !== 'done') paise += toPaise(s.share_amount);
      }
    } else {
      // As a debtor: only counts once settled (before that it's a pending "-share" row).
      for (const s of rows) {
        if (s.debtor_id === userId && s.status === 'done') paise += toPaise(s.share_amount);
      }
    }
  }
  return toRupees(paise);
}

/**
 * The pending amount a user still owes (sum of their 'pending' shares in expenses
 * they did NOT pay). Rendered as the negative "borrowed" figure.
 */
export function pendingOwedByUser(expenses, splits, userId) {
  const payerByExpense = new Map(expenses.map((e) => [e.id, e.payer_id]));
  let paise = 0;
  for (const s of splits) {
    if (s.debtor_id === userId && s.status === 'pending' && payerByExpense.get(s.expense_id) !== userId) {
      paise += toPaise(s.share_amount);
    }
  }
  return toRupees(paise);
}

// ---------------------------------------------------------------------------
// Pairwise netting between two members. Debts run in both directions (each member
// can pay expenses the other owes a share of); the app nets them into a single
// figure per pair. Because splits stay 'pending' and we net the two directions at
// read time, opposing debts cancel automatically — no stored settlement is needed,
// and deleting/editing an expense reverts the net for free.
//
// Settlement is expressed ENTIRELY by flipping shares to 'done': a per-row settle
// marks one share done; "Settle up" marks every pending share between the pair
// done in both directions. A `settlements` row is written only as a HISTORY log of
// a real payment and is deliberately NOT part of this calculation (doing so would
// double-count against the already-'done' shares). All math is in integer paise.
// ---------------------------------------------------------------------------

// Raw pending debt `debtor` owes `creditor`: sum of debtor's still-pending shares
// on expenses that `creditor` paid. (In paise.)
function rawPendingPaise(expenses, splits, debtor, creditor) {
  const paidByCreditor = new Set(expenses.filter((e) => e.payer_id === creditor).map((e) => e.id));
  let paise = 0;
  for (const s of splits) {
    if (s.debtor_id === debtor && s.status === 'pending' && paidByCreditor.has(s.expense_id)) {
      paise += toPaise(s.share_amount);
    }
  }
  return paise;
}

/**
 * Signed net between users U and M, in PAISE:
 *   > 0  => U owes M that much
 *   < 0  => M owes U that much
 *   = 0  => settled
 * Purely the difference of the two directions' still-pending shares; 'done' shares
 * (settled per-row or via Settle up) simply drop out.
 */
export function netBetweenPaise(expenses, splits, U, M) {
  return rawPendingPaise(expenses, splits, U, M) - rawPendingPaise(expenses, splits, M, U);
}

/**
 * Signed net between users U and M, in rupees:
 *   > 0  => U owes M; < 0  => M owes U; = 0 => settled.
 */
export function netBetween(expenses, splits, U, M) {
  return toRupees(netBetweenPaise(expenses, splits, U, M));
}

// ---- Debt simplification (per-user view + settle routing) ------------------
// The pieces below re-route balances so a member settles with fewer payments,
// without touching the underlying expense_splits (they stay the source of truth).

/**
 * Each member's overall signed balance across the whole group, in PAISE.
 * > 0  => the member is a net debtor (owes others overall)
 * < 0  => the member is a net creditor (is owed overall)
 * The values sum to 0 (paise-exact), since every pending share is one debtor's
 * debit and one payer's credit.
 * Returns a Map<userId, paise>.
 */
export function groupNetsPaise(expenses, splits, memberIds) {
  const nets = new Map(memberIds.map((id) => [id, 0]));
  // Sum each ordered pair once; add to debtor, subtract from creditor.
  for (let i = 0; i < memberIds.length; i++) {
    for (let j = i + 1; j < memberIds.length; j++) {
      const a = memberIds[i];
      const b = memberIds[j];
      const ab = netBetweenPaise(expenses, splits, a, b); // >0 => a owes b
      if (ab === 0) continue;
      nets.set(a, nets.get(a) + ab);
      nets.set(b, nets.get(b) - ab);
    }
  }
  return nets;
}

/**
 * Greedy minimum-cash-flow: given signed balances (paise), produce the transfers
 * that settle everyone in at most (n-1) payments. Each transfer is
 * { from, to, amount } in paise, amount > 0 (from = debtor, to = creditor).
 * `nets` is a Map<userId, paise>; it is not mutated.
 */
export function simplifyTransfers(nets) {
  // Work on copies so callers keep their map.
  const debtors = []; // { id, amt } amt>0 (owes)
  const creditors = []; // { id, amt } amt>0 (is owed)
  for (const [id, paise] of nets) {
    if (paise > 0) debtors.push({ id, amt: paise });
    else if (paise < 0) creditors.push({ id, amt: -paise });
  }
  // Largest first for a compact result.
  debtors.sort((x, y) => y.amt - x.amt);
  creditors.sort((x, y) => y.amt - x.amt);

  const transfers = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di];
    const c = creditors[ci];
    const pay = Math.min(d.amt, c.amt);
    if (pay > 0) transfers.push({ from: d.id, to: c.id, amount: pay });
    d.amt -= pay;
    c.amt -= pay;
    if (d.amt === 0) di++;
    if (c.amt === 0) ci++;
  }
  return transfers;
}

/**
 * The simplified view for one user: run the group-wide reduction, then keep only
 * the transfers that involve `userId`. Amounts are in RUPEES to match the card
 * helpers.
 *   owe:  [{ toId, amount }]   — people this user should pay
 *   owed: [{ fromId, amount }] — people who should pay this user
 */
export function simplifiedForUser(expenses, splits, memberIds, userId) {
  const transfers = simplifyTransfers(groupNetsPaise(expenses, splits, memberIds));
  const owe = [];
  const owed = [];
  for (const t of transfers) {
    if (t.from === userId) owe.push({ toId: t.to, amount: toRupees(t.amount) });
    else if (t.to === userId) owed.push({ fromId: t.from, amount: toRupees(t.amount) });
  }
  return { owe, owed };
}
