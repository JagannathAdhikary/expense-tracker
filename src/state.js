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
};

// Set of date strings whose groups are collapsed; default all expanded.
export const collapsed = new Set();
