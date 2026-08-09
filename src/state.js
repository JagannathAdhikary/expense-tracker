// Central mutable app state. ES module bindings are read-only, so anything that
// changes at runtime lives on this object and is mutated in place by other modules.
// storage.js populates recs/CATS/PAYS/PREFS on init; selCat/selPay are seeded after
// load in main.js once defaults are known.

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  return d;
};

export const state = {
  recs: [],
  CATS: [],
  PAYS: [],
  PREFS: { defaultCat: null, defaultPay: null, cloudSync: false },
  selCat: null,
  selPay: null,
  editId: null,
  cur: startOfMonth(), // current month being viewed (day pinned to 1)
  filterCat: null, // when set, category-detail view is active
  // Home transaction-list filter (via the Filter button). Empty = show everything.
  filter: {
    scope: 'all', // 'all' | 'group' | 'personal'
    cats: [], // category names to include (empty = all)
    groupId: null, // a specific group id to restrict to (null = any)
    pays: [], // payment-method names to include (empty = all)
  },
  newCatColor: null, // pending color while adding a category

  // --- Collaboration (cloud) ---
  user: null, // signed-in user {id,email,name,avatar} or null (local-only)
  groups: [], // groups the user belongs to: {id,name,invite_code,members:[{id,name,avatar}]}
  groupExpenses: [], // group_expenses rows visible to the user
  mySplits: [], // expense_splits rows involving the user (for borrowed rows + settle)
  settlements: [], // settlements rows for the user's groups (auto-netting + manual settle-ups)
  openGroupId: null, // group currently open in the Groups detail view
  focusGroupExpId: null, // expense to scroll to + flash when the detail view opens
  // add/edit form group tagging:
  selGroup: null, // group id tagged on the expense being added, or null
  selSplitMode: 'equal', // 'equal' | 'amount' | 'percent'
  splitWeights: {}, // per-member weights for amount/percent modes (keyed by user id)
  editGroupExpId: null, // when set, the add form is editing this cloud group expense
  groupEditLocked: false, // when editing a group expense that already has a payment: lock amount/group/split
  groupPickLocked: false, // when adding from a group's detail page: lock the expense to that group (no "Just me"/others)
  editMySplitId: null, // when set, editing only my personal cat/pay/note on a settled group split
};

// Set of date strings whose groups are collapsed; default all expanded.
export const collapsed = new Set();

// Same, but for the group-detail expense list (kept separate so collapsing a
// date there doesn't also collapse it on the home list, which shares dates).
export const groupCollapsed = new Set();
