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
  PREFS: { defaultCat: null, defaultPay: null },
  selCat: null,
  selPay: null,
  editId: null,
  cur: startOfMonth(), // current month being viewed (day pinned to 1)
  filterCat: null, // when set, category-detail view is active
  newCatColor: null, // pending color while adding a category

  // --- Collaboration (cloud) ---
  user: null, // signed-in user {id,email,name,avatar} or null (local-only)
  groups: [], // groups the user belongs to: {id,name,invite_code,members:[{id,name,avatar}]}
  groupExpenses: [], // group_expenses rows visible to the user
  mySplits: [], // expense_splits rows involving the user (for borrowed rows + settle)
  openGroupId: null, // group currently open in the Groups detail view
  // add/edit form group tagging:
  selGroup: null, // group id tagged on the expense being added, or null
  selSplitMode: 'equal', // 'equal' | 'amount' | 'percent'
  splitWeights: {}, // per-member weights for amount/percent modes (keyed by user id)
};

// Set of date strings whose groups are collapsed; default all expanded.
export const collapsed = new Set();
