import { describe, it, expect } from 'vitest';
import { computeSplits, netForUser, pendingOwedByUser } from '../src/split.js';

const sum = (shares) => shares.reduce((s, x) => s + x.share, 0);

describe('computeSplits', () => {
  it('splits equally and sums exactly to the amount', () => {
    const s = computeSplits({ amount: 300, members: ['A', 'B', 'C'], mode: 'equal', payerId: 'A' });
    expect(s).toEqual([
      { userId: 'A', share: 100 },
      { userId: 'B', share: 100 },
      { userId: 'C', share: 100 },
    ]);
    expect(sum(s)).toBe(300);
  });

  it('handles non-divisible equal splits with the payer absorbing the remainder', () => {
    const s = computeSplits({ amount: 100, members: ['A', 'B', 'C'], mode: 'equal', payerId: 'A' });
    expect(sum(s)).toBe(100);
    expect(s.find((x) => x.userId === 'A').share).toBe(33.34);
  });

  it('percent mode scales to the total and sums exactly', () => {
    const s = computeSplits({ amount: 100, members: ['A', 'B', 'C'], mode: 'percent', weights: { A: 50, B: 30, C: 20 }, payerId: 'A' });
    expect(sum(s)).toBe(100);
    expect(s).toEqual([
      { userId: 'A', share: 50 },
      { userId: 'B', share: 30 },
      { userId: 'C', share: 20 },
    ]);
  });

  it('amount mode assigns leftover to the payer', () => {
    const s = computeSplits({ amount: 100, members: ['A', 'B', 'C'], mode: 'amount', weights: { A: 40, B: 35, C: 20 }, payerId: 'A' });
    expect(sum(s)).toBe(100);
    expect(s.find((x) => x.userId === 'A').share).toBe(45); // 40 + 5 leftover
  });
});

describe('netForUser / pendingOwedByUser — worked example', () => {
  const members = ['A', 'B', 'C'];
  const exp = [{ id: 'e1', payer_id: 'A' }];
  const build = (othersStatus) =>
    computeSplits({ amount: 300, members, mode: 'equal', payerId: 'A' }).map((s) => ({
      expense_id: 'e1',
      debtor_id: s.userId,
      share_amount: s.share,
      status: s.userId === 'A' ? 'done' : othersStatus,
    }));

  it('before settlement: A carries 300, B and C carry 0, B owes 100', () => {
    const rows = build('pending');
    expect(netForUser(exp, rows, 'A')).toBe(300);
    expect(netForUser(exp, rows, 'B')).toBe(0);
    expect(netForUser(exp, rows, 'C')).toBe(0);
    expect(pendingOwedByUser(exp, rows, 'B')).toBe(100);
  });

  it('after settlement: everyone rebalances to their 100 fair share', () => {
    const rows = build('done');
    expect(netForUser(exp, rows, 'A')).toBe(100);
    expect(netForUser(exp, rows, 'B')).toBe(100);
    expect(netForUser(exp, rows, 'C')).toBe(100);
    expect(pendingOwedByUser(exp, rows, 'B')).toBe(0);
  });
});
