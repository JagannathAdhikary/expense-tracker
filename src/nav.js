// Tiny screen navigation stack so every back button returns to the ACTUAL previous
// screen instead of hardcoding "home". Screens are the top-level <div class="screen">
// ids: home, catview, analytics, groups, add.
//
// Usage: call navTo('analytics') when entering a screen (it records where you came
// from), and navBack() from a back button (pops to the previous screen). Screen
// setup (state.filterCat, state.openGroupId, renders) is still done by the existing
// show*() functions — nav.js only owns which screen is visible + the history.

import { $ } from './dom.js';

const SCREENS = ['home', 'catview', 'analytics', 'groups', 'add', 'newGroup'];
const stack = []; // screen ids visited, oldest first; last = current

// The screen currently marked active in the DOM (source of truth on first use).
function currentScreen() {
  return SCREENS.find((id) => $(id).classList.contains('active')) || 'home';
}

function activate(id) {
  SCREENS.forEach((s) => $(s).classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo(0, 0);
}

// Go to `id`, remembering the screen we're leaving so navBack() can return to it.
// Pass { replace:true } to swap the current entry instead of stacking (e.g. when a
// save should not leave the add screen on the back stack).
export function navTo(id, { replace = false } = {}) {
  const from = currentScreen();
  if (stack.length === 0) stack.push(from); // seed with wherever we started
  if (replace) stack[stack.length - 1] = id;
  else if (stack[stack.length - 1] !== id) stack.push(id);
  activate(id);
}

// Pop to the previous screen. Returns the id we navigated to (for callers that
// need to re-render it), defaulting to 'home' when the stack is empty.
export function navBack() {
  if (stack.length > 1) stack.pop();
  const to = stack[stack.length - 1] || 'home';
  activate(to);
  return to;
}

// Reset the stack to a single screen (used by showHome to make home the root).
export function navReset(id = 'home') {
  stack.length = 0;
  stack.push(id);
  activate(id);
}

// The id of the screen a back action would return to (without navigating).
export function navPrev() {
  return stack.length > 1 ? stack[stack.length - 2] : 'home';
}
