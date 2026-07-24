import { describe, it, expect } from 'vitest';
import { computeSplits, netBetween } from '../src/split.js';

// Helper: build expense_splits rows for one equal-split expense (payer's own share
// is 'done'; everyone else 'pending', as saveGroupExpense records them).
const equalSplits = (expId, amount, members, payer) =>
  computeSplits({ amount, members, mode: 'equal', payerId: payer }).map((s) => ({
    expense_id: expId,
    debtor_id: s.userId,
    share_amount: s.share,
    status: s.userId === payer ? 'done' : 'pending',
  }));

describe('netBetween — single direction', () => {
  it('A pays 500 equally with B: B owes A 250 (net(A,B) = -250)', () => {
    const exps = [{ id: 'e1', group_id: 'g', payer_id: 'A' }];
    const splits = equalSplits('e1', 500, ['A', 'B'], 'A');
    expect(netBetween(exps, splits, 'A', 'B')).toBe(-250); // B owes A 250
    expect(netBetween(exps, splits, 'B', 'A')).toBe(250); // symmetric
  });

  it('settling the share (status done) discharges the debt', () => {
    const exps = [{ id: 'e1', group_id: 'g', payer_id: 'A' }];
    // B's share marked done (paid back) → nothing pending → net 0.
    const splits = equalSplits('e1', 500, ['A', 'B'], 'A').map((s) => (s.debtor_id === 'B' ? { ...s, status: 'done' } : s));
    expect(netBetween(exps, splits, 'A', 'B')).toBe(0);
  });
});

describe('netting opposing expenses — the worked example', () => {
  it('A pays 500 then B pays 200 → B owes A 150 net (automatic, no settlement rows)', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' }, // B owes A 250
      { id: 'e2', group_id: 'g', payer_id: 'B' }, // A owes B 100
    ];
    const splits = [...equalSplits('e1', 500, ['A', 'B'], 'A'), ...equalSplits('e2', 200, ['A', 'B'], 'B')];
    // net(A,B) = A owes B 100 − B owes A 250 = −150 → B owes A 150.
    expect(netBetween(exps, splits, 'A', 'B')).toBe(-150);
  });
});

describe('opposing expense larger than existing debt flips the net', () => {
  it('B ends up owed when their expense exceeds what they owed', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' }, // A paid 500 → B owes A 250
      { id: 'e2', group_id: 'g', payer_id: 'B' }, // B paid 600 → A owes B 300
    ];
    const splits = [...equalSplits('e1', 500, ['A', 'B'], 'A'), ...equalSplits('e2', 600, ['A', 'B'], 'B')];
    // net(A,B) = 300 − 250 = +50 → A owes B 50.
    expect(netBetween(exps, splits, 'A', 'B')).toBe(50);
  });
});

describe('exact cancel → net 0', () => {
  it('equal opposing debts net to zero', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' },
      { id: 'e2', group_id: 'g', payer_id: 'B' },
    ];
    const splits = [...equalSplits('e1', 500, ['A', 'B'], 'A'), ...equalSplits('e2', 500, ['A', 'B'], 'B')];
    expect(netBetween(exps, splits, 'A', 'B')).toBe(0);
  });
});

describe('>2 members — netting is strictly pairwise', () => {
  it('each pair nets independently; no cross-debtor bleed', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' }, // A paid 300 eq: B & C each owe A 100
      { id: 'e2', group_id: 'g', payer_id: 'B' }, // B paid 300 eq: A & C each owe B 100
    ];
    const splits = [...equalSplits('e1', 300, ['A', 'B', 'C'], 'A'), ...equalSplits('e2', 300, ['A', 'B', 'C'], 'B')];
    expect(netBetween(exps, splits, 'A', 'B')).toBe(0); // A↔B fully offset (100 vs 100)
    expect(netBetween(exps, splits, 'C', 'A')).toBe(100); // C still owes A 100
    expect(netBetween(exps, splits, 'C', 'B')).toBe(100); // C still owes B 100
  });
});

describe('rounding — integer paise, no drift', () => {
  it('100 split 3 ways plus a reverse expense stays exact', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' },
      { id: 'e2', group_id: 'g', payer_id: 'B' },
    ];
    const splits = [...equalSplits('e1', 100, ['A', 'B', 'C'], 'A'), ...equalSplits('e2', 100, ['A', 'B', 'C'], 'B')];
    // A and B have equal 33.33 shares in each other's expenses → net 0, no 0.01 residue.
    expect(netBetween(exps, splits, 'A', 'B')).toBe(0);
  });
});

describe('multiple expenses, same pair — aggregate net', () => {
  it('debts accumulate then net across the running total', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' }, // B owes A 300
      { id: 'e2', group_id: 'g', payer_id: 'B' }, // A owes B 100
      { id: 'e3', group_id: 'g', payer_id: 'B' }, // A owes B 100
    ];
    const splits = [
      ...equalSplits('e1', 600, ['A', 'B'], 'A'),
      ...equalSplits('e2', 200, ['A', 'B'], 'B'),
      ...equalSplits('e3', 200, ['A', 'B'], 'B'),
    ];
    // net(A,B) = (100+100) − 300 = −100 → B owes A 100.
    expect(netBetween(exps, splits, 'A', 'B')).toBe(-100);
  });
});

describe('per-row settle recomputes the net (the 400/500 case)', () => {
  it('A pays 400 then B pays 500 → A owes B 50; A settling the 250 row flips it to B owes A 200', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' }, // A paid 400 → B owes A 200
      { id: 'e2', group_id: 'g', payer_id: 'B' }, // B paid 500 → A owes B 250
    ];
    const splits = [...equalSplits('e1', 400, ['A', 'B'], 'A'), ...equalSplits('e2', 500, ['A', 'B'], 'B')];
    expect(netBetween(exps, splits, 'A', 'B')).toBe(50); // A owes B 50

    // A pays the full 250 row (marks A's share of e2 done).
    const afterRowSettle = splits.map((s) => (s.expense_id === 'e2' && s.debtor_id === 'A' ? { ...s, status: 'done' } : s));
    // Now only B owes A 200 remains pending.
    expect(netBetween(exps, afterRowSettle, 'A', 'B')).toBe(-200); // B owes A 200
  });
});

describe('revert — deleting the triggering expense restores the debt', () => {
  it('removing e2 returns the net to B owes A 250 (no cleanup needed)', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' },
      { id: 'e2', group_id: 'g', payer_id: 'B' },
    ];
    const splits = [...equalSplits('e1', 500, ['A', 'B'], 'A'), ...equalSplits('e2', 200, ['A', 'B'], 'B')];
    expect(netBetween(exps, splits, 'A', 'B')).toBe(-150);
    // Delete e2: just drop its expense + splits. Net reverts automatically.
    const expsAfter = exps.filter((e) => e.id !== 'e2');
    const splitsAfter = splits.filter((s) => s.expense_id !== 'e2');
    expect(netBetween(expsAfter, splitsAfter, 'A', 'B')).toBe(-250);
  });
});

describe('settle-up both directions → net 0', () => {
  it('flipping all pending shares both ways nets to zero', () => {
    const exps = [
      { id: 'e1', group_id: 'g', payer_id: 'A' },
      { id: 'e2', group_id: 'g', payer_id: 'B' },
    ];
    const settled = [...equalSplits('e1', 500, ['A', 'B'], 'A'), ...equalSplits('e2', 200, ['A', 'B'], 'B')].map((s) => ({ ...s, status: 'done' }));
    expect(netBetween(exps, settled, 'A', 'B')).toBe(0);
  });
});
