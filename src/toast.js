// Lightweight toast notifications. Replaces blocking alert() for user-facing
// success/error/info messages. Non-blocking, auto-dismisses, stacks bottom-center.

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.className = 'toast-wrap';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast.
 * @param {string} msg   message text
 * @param {'info'|'success'|'error'} [type]
 * @param {number} [ms]  visible duration in ms
 */
export function showToast(msg, type = 'info', ms = 3000) {
  const wrap = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  wrap.appendChild(el);
  // Trigger enter transition on next frame.
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => {
    el.classList.remove('show');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    // Fallback removal in case transitionend doesn't fire.
    setTimeout(() => el.remove(), 400);
  };
  const timer = setTimeout(remove, ms);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

export const toastError = (msg) => showToast(msg, 'error', 4000);
export const toastSuccess = (msg) => showToast(msg, 'success', 2500);
export const toastInfo = (msg) => showToast(msg, 'info', 3000);
