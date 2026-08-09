import { describe, it, expect } from 'vitest';
import { matchFriends } from '../src/friends.js';

const friends = [
  { id: '1', name: 'Rahul Sharma', phone: '+919876543210' },
  { id: '2', name: 'Priya Nair', phone: '9123456789' },
  { id: '3', name: 'Sam', phone: null },
];

describe('matchFriends', () => {
  it('returns [] for an empty query', () => {
    expect(matchFriends(friends, '')).toEqual([]);
    expect(matchFriends(friends, '   ')).toEqual([]);
  });
  it('matches by case-insensitive name substring', () => {
    expect(matchFriends(friends, 'rah').map((f) => f.id)).toEqual(['1']);
    expect(matchFriends(friends, 'NAIR').map((f) => f.id)).toEqual(['2']);
    expect(matchFriends(friends, 'a').map((f) => f.id)).toEqual(['1', '2', '3']); // Rahul, Priya Nair, Sam all contain 'a'
  });
  it('matches by 10-digit phone once 10 digits entered (ignores +91/spaces)', () => {
    expect(matchFriends(friends, '9876543210').map((f) => f.id)).toEqual(['1']);
    expect(matchFriends(friends, '98765 43210').map((f) => f.id)).toEqual(['1']);
    expect(matchFriends(friends, '+91 91234 56789').map((f) => f.id)).toEqual(['2']);
  });
  it('short digit strings still search by name, not phone', () => {
    expect(matchFriends(friends, '91234').map((f) => f.id)).toEqual([]); // <10 digits, no name has "91234"
  });
  it('no phone match returns empty (friend with null phone never matches a number)', () => {
    expect(matchFriends(friends, '0000000000')).toEqual([]);
  });
});
