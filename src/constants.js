// Static configuration and default data used across the app.

export const DEFAULT_CATS = [
  { n: 'Living', e: '🏠', c: '#1E3A5F' },
  { n: 'Investments', e: '📈', c: '#1A6B3A' },
  { n: 'Lifestyle', e: '✨', c: '#7D3C98' },
  { n: 'Food', e: '🍽️', c: '#C0392B' },
  { n: 'Transport', e: '🚗', c: '#D35400' },
  { n: 'Health', e: '💊', c: '#0E6655' },
  { n: 'Other', e: '📦', c: '#808B96' },
];

export const DEFAULT_PAYS = [
  { n: 'UPI', e: '📲' },
  { n: 'Cash', e: '💵' },
  { n: 'Credit', e: '💳' },
  { n: 'Gift', e: '🎁' },
];

export const PALETTE = ['#1E3A5F', '#1A6B3A', '#7D3C98', '#C0392B', '#D35400', '#0E6655', '#808B96', '#2874A6', '#B7950B', '#CA6F1E', '#943126', '#117A65', '#5B2C6F', '#34495E'];

export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Payment names with dedicated color classes in the stylesheet; others render as "custom".
export const BUILTIN_PAYS = ['UPI', 'Cash', 'Credit', 'Gift'];
