// Full-screen profile onboarding journey: one step at a time (Welcome → Name →
// Mobile → UPI → Done) with a top progress bar. Shown after login when the profile
// is incomplete; saves via saveMyProfile on finish, then enters the app.

import { state } from '../state.js';
import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { isValidPhone } from '../phone.js';
import { isValidUpi, normalizeUpi } from '../upi.js';
import { saveMyProfile, profileComplete } from './profile.js';

const STEPS = 5; // 0 welcome, 1 name, 2 mobile, 3 upi, 4 done
let step = 0;
let onDone = null; // called once the journey completes / app should proceed

const stepEl = (n) => document.querySelector(`#onboarding .ob-step[data-step="${n}"]`);

function showFieldErr(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? '' : 'none';
}

function render() {
  for (let n = 0; n < STEPS; n++) stepEl(n).hidden = n !== step;
  // Progress fills across steps (welcome = a sliver, done = full).
  $('obProgress').style.width = Math.round((step / (STEPS - 1)) * 100) + '%';
  // Back shows on the field steps only — not Welcome (0) or Done (last).
  $('obBack').style.display = step === 0 || step === STEPS - 1 ? 'none' : '';
  $('obSkip').style.display = step === 3 ? '' : 'none'; // UPI is skippable
  // Center the actions row only when Next is the sole control (Welcome / Done).
  const lone = step === 0 || step === STEPS - 1;
  $('obNext').classList.toggle('ob-next--lone', lone);
  $('obNext').textContent = step === STEPS - 1 ? 'Get started' : step === 0 ? 'Let’s go' : 'Next';
  // Focus the input on field steps.
  const input = { 1: 'obName', 2: 'obPhone', 3: 'obUpi' }[step];
  if (input) setTimeout(() => $(input).focus(), 80);
}

// Validate the current step before advancing. Returns true if OK.
function validateStep() {
  if (step === 1) {
    if (!$('obName').value.trim()) {
      showFieldErr('obNameErr', 'Please enter your name.');
      return false;
    }
  } else if (step === 2) {
    if (!isValidPhone($('obPhone').value)) {
      showFieldErr('obPhoneErr', 'Enter a valid mobile number.');
      return false;
    }
  } else if (step === 3) {
    const u = normalizeUpi($('obUpi').value);
    if (u && !isValidUpi(u)) {
      showFieldErr('obUpiErr', 'Use the form name@bank (e.g. rahul@okaxis).');
      return false;
    }
  }
  return true;
}

async function finish() {
  // Persist name + phone (+ optional UPI). If save fails validation, jump back.
  const res = await saveMyProfile({ name: $('obName').value, phone: $('obPhone').value, upi: $('obUpi').value });
  if (!res.ok) {
    // Surface the first offending field by returning to its step.
    if (res.errors.name) step = 1;
    else if (res.errors.phone) step = 2;
    else if (res.errors.upi) step = 3;
    render();
    showFieldErr('obNameErr', res.errors.name);
    showFieldErr('obPhoneErr', res.errors.phone);
    showFieldErr('obUpiErr', res.errors.upi);
    return;
  }
  $('onboarding').classList.remove('active');
  if (onDone) onDone();
}

function next() {
  if (!validateStep()) return;
  if (step === STEPS - 1) {
    finish();
    return;
  }
  step++;
  render();
}

function back() {
  if (step > 0) {
    step--;
    render();
  }
}

// Start the journey. `done` is invoked when the user finishes (to enter the app).
export function startOnboarding(done) {
  onDone = done;
  step = 0;
  $('obName').value = state.user?.name || ''; // prefill from Google
  $('obPhone').value = state.user?.phone || '';
  $('obUpi').value = state.user?.upi || '';
  ['obNameErr', 'obPhoneErr', 'obUpiErr'].forEach((id) => showFieldErr(id, ''));
  ['home', 'catview', 'analytics', 'add', 'groups'].forEach((s) => $(s).classList.remove('active'));
  $('onboarding').classList.add('active');
  render();
}

// Open the journey after login if the profile is incomplete. Returns true if shown.
export function onboardingIfNeeded(done) {
  if (profileComplete()) return false;
  startOnboarding(done);
  return true;
}

export function initOnboarding() {
  // Fill each step's icon holder with its SVG (line-icon style, matches the app).
  document.querySelectorAll('#onboarding .ob-ico[data-icon]').forEach((el) => {
    const fn = icon[el.dataset.icon];
    if (fn) el.innerHTML = fn({ size: 34 });
  });
  $('obNext').onclick = next;
  $('obBack').onclick = back;
  $('obSkip').onclick = () => {
    $('obUpi').value = ''; // skip = leave UPI empty
    next();
  };
  // Clear inline errors as the user types.
  [['obName', 'obNameErr'], ['obPhone', 'obPhoneErr'], ['obUpi', 'obUpiErr']].forEach(([inp, err]) => {
    $(inp).addEventListener('input', () => showFieldErr(err, ''));
    // Enter advances on field steps.
    $(inp).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') next();
    });
  });
}
