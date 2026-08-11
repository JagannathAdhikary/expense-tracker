import { describe, it, expect } from 'vitest';
import { computeSplits, groupNetsPaise, simplifyTransfers, simplifiedForUser } from '../src/split.js';

// Same fixture helper as netting.test.js: equal-split expense, payer's share 'done'.
const equalSplits = (expId, amount, members, payer) =>
  computeSplits({ amount, members, mode: 'equal', payerId: payer }).map((s) => ({
    expense_id: expId,
    debtor_id: s.userId,
    share_amount: s.share,
    status: s.userId === payer ? 'done' : 'pending',
  }));

describe('groupNetsPaise', () => {
  it('nets sum to zero and reflect who owes overall', () => {
    // A pays 300 split among A,B,C -> B owes A 100, C owes A 100.
    const exps = [{ id: 'e1', group_id: 'g', payer_id: 'A' }];
    const splits = equalSplits('e1', 300, ['A', 'B', 'C'], 'A');
    const nets = groupNetsPaise(exps, splits, ['A', 'B', 'C']);
    expect(nets.get('A')).toBe(-20000); // owed 200.00 (paise, negative = creditor)
    expect(nets.get('B')).toBe(10000);
    expect(nets.get('C')).toBe(10000);
    expect(nets.get('A') + nets.get('B') + nets.get('C')).toBe(0);
  });
});

describe('simplifyTransfers', () => {
  it('produces at most n-1 transfers and clears all balances', () => {
    const nets = new Map([
      ['A', -20000], // owed 200
      ['B', 10000], // owes 100
      ['C', 10000], // owes 100
    ]);
    const t = simplifyTransfers(nets);
    expect(t.length).toBeLessThanOrEqual(2);
    // Everyone ends at zero.
    const bal = new Map(nets);
    for (const { from, to, amount } of t) {
      bal.set(from, bal.get(from) - amount);
      bal.set(to, bal.get(to) + amount);
    }
    for (const v of bal.values()) expect(v).toBe(0);
  });

  it('handles an empty / already-settled group', () => {
    expect(simplifyTransfers(new Map([['A', 0], ['B', 0]]))).toEqual([]);
  });
});

describe('simplifiedForUser — chain reduction', () => {
  it('reroutes D->U, U->B into fewer payments for U', () => {
    // B pays 200 split B,U  -> U owes B 100.
    // U pays 300 split U,D  -> D owes U 150.
    // Raw: U owes B 100, and D owes U 150 (two touchpoints for U).
    // Net balances: B = -100 (owed), U = 100-150 = -50 (owed net), D = 150 (owes).
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'B' },
      { id: 'e2', group_id: 'g', payer_id: 'U' },
    ];
    const splits = [...equalSplits('e1', 200, ['B', 'U'], 'B'), ...equalSplits('e2', 300, ['U', 'D'], 'U')];
    const members = ['B', 'U', 'D'];
    const nets = groupNetsPaise(exps, splits, members);
    expect(nets.get('B')).toBe(-10000); // owed 100
    expect(nets.get('U')).toBe(-5000); // owed 50 net
    expect(nets.get('D')).toBe(15000); // owes 150

    // Simplified for U: U is a net creditor (owed 50), so U only receives — no payments to make.
    const uView = simplifiedForUser(exps, splits, members, 'U');
    expect(uView.owe).toEqual([]);
    expect(uView.owed.reduce((s, x) => s + x.amount, 0)).toBe(50);

    // D (the net debtor of 150) pays out 150 total, routed to the two creditors.
    const dView = simplifiedForUser(exps, splits, members, 'D');
    expect(dView.owed).toEqual([]);
    expect(dView.owe.reduce((s, x) => s + x.amount, 0)).toBe(150);
  });
});
