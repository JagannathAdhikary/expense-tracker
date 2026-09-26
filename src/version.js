// Single source of the app version at runtime. `__APP_VERSION__` is injected by
// Vite's `define` (see vite.config.js) from package.json's `version` field. The
// `typeof` guard keeps this safe in any context where the define isn't applied
// (falls back to '0.0.0', which reads as "unknown / older than any real build").
/* global __APP_VERSION__ */
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
