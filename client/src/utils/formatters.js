export const formatCurrency = (amount, currency = 'KES') => {
  const raw = new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount ?? 0);
  return raw.replace(/^KSh\s?|^KES\s?|^\$\s?/, 'Ksh ');
};

// Compact version for stat cards — avoids wrapping on narrow cards
// e.g. 1,950 → "Ksh 1,950"  |  125,000 → "Ksh 125K"  |  2,500,000 → "Ksh 2.5M"
export const formatCurrencyCompact = (amount) => {
  const n = Math.abs(amount ?? 0);
  if (n >= 1_000_000) return `Ksh ${(amount / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 100_000)   return `Ksh ${(amount / 1_000).toFixed(0)}K`;
  if (n >= 10_000)    return `Ksh ${(amount / 1_000).toFixed(1)}K`;
  return formatCurrency(amount);
};

// Parse a value from the API into a JS Date.
// Date-only strings (YYYY-MM-DD) are treated as local midnight, not UTC midnight,
// to avoid the off-by-one that new Date("2026-06-29") causes in UTC+offset browsers.
function parseDate(date) {
  if (!date) return null;
  if (date instanceof Date) return date;
  const s = String(date);
  // Date-only string — append local-time marker so it doesn't get parsed as UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  return new Date(s);
}

export const formatDate = (date) => {
  const d = parseDate(date);
  if (!d || isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' }).format(d);
};

export const formatDateTime = (date) => {
  const d = parseDate(date);
  if (!d || isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
};

export const formatNumber = (n) =>
  new Intl.NumberFormat('en-KE').format(n ?? 0);

export const truncate = (str, len = 40) =>
  str?.length > len ? `${str.slice(0, len)}…` : str;

export function applyRounding(value, mode, unit) {
  if (!mode || mode === 'none' || !unit || unit <= 0) return value;
  if (mode === 'up')      return Math.ceil(value  / unit) * unit;
  if (mode === 'down')    return Math.floor(value / unit) * unit;
  if (mode === 'nearest') return Math.round(value / unit) * unit;
  return value;
}
