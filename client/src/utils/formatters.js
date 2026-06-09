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

export const formatDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' }).format(d);
};

export const formatDateTime = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
};

export const formatNumber = (n) =>
  new Intl.NumberFormat('en-KE').format(n ?? 0);

export const truncate = (str, len = 40) =>
  str?.length > len ? `${str.slice(0, len)}…` : str;
