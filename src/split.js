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
