// localStorage load + persistence. Keys and value shapes are unchanged from the
// original monolith so existing user data continues to load unmodified.

import { state } from './state.js';
import { DEFAULT_CATS, DEFAULT_PAYS } from './constants.js';

// Populate state from localStorage. Call once at startup.
export function initState() {
  try {
    state.recs = JSON.parse(localStorage.getItem('xpns') || '[]');
  } catch (e) {
    state.recs = [];
  }

  try {
    const stored = JSON.parse(localStorage.getItem('xpns_cats') || 'null');
    state.CATS = Array.isArray(stored) && stored.length ? stored : DEFAULT_CATS.slice();
  } catch (e) {
    state.CATS = DEFAULT_CATS.slice();
  }

  try {
    const stored = JSON.parse(localStorage.getItem('xpns_pays') || 'null');
    state.PAYS = Array.isArray(stored) && stored.length ? stored : DEFAULT_PAYS.slice();
  } catch (e) {
    state.PAYS = DEFAULT_PAYS.slice();
  }

  try {
    const stored = JSON.parse(localStorage.getItem('xpns_prefs') || 'null');
    if (stored && typeof stored === 'object') state.PREFS = { ...state.PREFS, ...stored };
  } catch (e) {
    /* keep defaults */
  }

  // Seed new keys on first run so future sessions load from storage.
  if (!localStorage.getItem('xpns_cats')) persistCats();
  if (!localStorage.getItem('xpns_pays')) persistPays();
}

export const persist = () => {
  try {
    localStorage.setItem('xpns', JSON.stringify(state.recs));
  } catch (e) {
    /* ignore quota/serialization errors */
  }
};

export const persistCats = () => {
  try {
    localStorage.setItem('xpns_cats', JSON.stringify(state.CATS));
  } catch (e) {
    /* ignore */
  }
};

export const persistPays = () => {
  try {
    localStorage.setItem('xpns_pays', JSON.stringify(state.PAYS));
  } catch (e) {
    /* ignore */
  }
};

export const persistPrefs = () => {
  try {
    localStorage.setItem('xpns_prefs', JSON.stringify(state.PREFS));
  } catch (e) {
    /* ignore */
  }
};
