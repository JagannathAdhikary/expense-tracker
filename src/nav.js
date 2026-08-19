// Tiny screen navigation stack so every back button returns to the ACTUAL previous
// screen instead of hardcoding "home". Screens are the top-level <div class="screen">
// ids: home, catview, analytics, groups, add.
//
// Usage: call navTo('analytics') when entering a screen (it records where you came
// from), and navBack() from a back button (pops to the previous screen). Screen
// setup (state.filterCat, state.openGroupId, renders) is still done by the existing
// show*() functions — nav.js only owns which screen is visible + the history.

import { $ } from './dom.js';

const SCREENS = ['home', 'catview', 'analytics', 'groups', 'add', 'newGroup', 'groupSettings'];
const stack = []; // screen ids visited, oldest first; last = current

// Remembered window scroll position per screen. Screens are display:none when
// inactive and the WINDOW scrolls, so the position is lost on switch unless we save
// and restore it. Lets Back return you to exactly where you were (e.g. open Add from
// a scrolled-down home, then Back → you're still scrolled down, not yanked to top).
const scrollByScreen = {};

// The screen currently marked active in the DOM (source of truth on first use).
function currentScreen() {
  return SCREENS.find((id) => $(id).classList.contains('active')) || 'home';
}

// Switch the visible screen. `restore`:
//   - false (default, forward nav) -> the destination starts at the top.
//   - true  (back nav)             -> the destination's remembered scroll is restored.
// Either way, the OUTGOING screen's scroll position is saved first so a later return
// to it can be restored.
function activate(id, { restore = false } = {}) {
  const from = currentScreen();
  if (from) scrollByScreen[from] = window.scrollY;

  SCREENS.forEach((s) => $(s).classList.remove('active'));
  $(id).classList.add('active');

  const y = restore ? scrollByScreen[id] || 0 : 0;
  window.scrollTo(0, y);
  // The back-to-top button (home only) shouldn't linger when we land at the top; the
  // home scroll listener re-shows it once scrolled down (or immediately if restored deep).
  const toTop = $('toTopBtn');
  if (toTop && y === 0) toTop.classList.remove('show');
}

// Go to `id`, remembering the screen we're leaving so navBack() can return to it.
// Forward navigation: the destination opens at the top. Pass { replace:true } to swap
// the current entry instead of stacking (e.g. a save shouldn't leave Add on the stack).
export function navTo(id, { replace = false } = {}) {
  const from = currentScreen();
  if (stack.length === 0) stack.push(from); // seed with wherever we started
  if (replace) stack[stack.length - 1] = id;
  else if (stack[stack.length - 1] !== id) stack.push(id);
  activate(id);
}

// Pop to the previous screen and RESTORE its scroll position (you return to where you
// were). Returns the id navigated to, defaulting to 'home' when the stack is empty.
export function navBack() {
  if (stack.length > 1) stack.pop();
  const to = stack[stack.length - 1] || 'home';
  activate(to, { restore: true });
  return to;
}

// Reset the stack to a single screen (used by showHome to make home the root). Starts
// at the top and forgets any remembered position for it.
export function navReset(id = 'home') {
  stack.length = 0;
  stack.push(id);
  scrollByScreen[id] = 0;
  activate(id);
}

// The id of the screen a back action would return to (without navigating).
export function navPrev() {
  return stack.length > 1 ? stack[stack.length - 2] : 'home';
}
