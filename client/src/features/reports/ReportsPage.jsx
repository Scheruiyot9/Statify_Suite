import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  TrendingUp, ShoppingCart, Users, BarChart2, Calendar,
  FileText, Scale, AlertTriangle, Package, Truck,
  ArrowDownLeft, ArrowUpRight, Droplets, CreditCard, Printer, RefreshCw,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/app/store';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { PageSpinner } from '@/components/ui/Spinner';

// ── Shared utilities ──────────────────────────────────────────────────────────

function toISO(d) { return d.toISOString().slice(0, 10); }

const today = toISO(new Date());

const PRINT_CSS = `
  body{font-family:Arial,sans-serif;padding:24px;color:#111;font-size:12px}
  h1{font-size:17px;margin:0 0 2px}
  .period{color:#666;font-size:11px;margin-bottom:18px}
  h2{font-size:13px;font-weight:700;margin:20px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:18px}
  th{text-align:left;border-bottom:1px solid #999;padding:5px 8px;font-size:11px;font-weight:600;background:#f5f5f5}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right} .b{font-weight:700} .red{color:#dc2626} .grn{color:#16a34a}
  tfoot td{font-weight:700;border-top:2px solid #999;border-bottom:none}
  @media print{@page{margin:15mm}}
`;

function printReport(title, period, html) {
  // window.open() is blocked on Android WebView (CS30 POS). Instead inject an
  // overlay div and use window.print() with @media print CSS to isolate it.
  const OID = '__rpt_ov';
  const SID = '__rpt_st';
  document.getElementById(OID)?.remove();
  document.getElementById(SID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OID;
  overlay.style.display = 'none';
  overlay.innerHTML = `<h1>${title}</h1><p class="period">${period}</p>${html}`;
  document.body.appendChild(overlay);

  const baseCSS = PRINT_CSS.replace('@media print{@page{margin:15mm}}', '');
  const style = document.createElement('style');
  style.id = SID;
  style.media = 'print';
  style.textContent = `
    @page { size: A4 portrait; margin: 15mm; }
    body > *:not(#${OID}) { display: none !important; }
    #${OID} { display: block !important; width: 100%; }
    ${baseCSS}
  `;
  document.head.appendChild(style);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.getElementById(OID)?.remove();
    document.getElementById(SID)?.remove();
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 60_000);

  setTimeout(() => window.print(), 100);
}

const PRESETS = [
  { label: 'Today',    days: 0   },
  { label: 'Last 7d',  days: 6   },
  { label: 'Last 30d', days: 29  },
  { label: 'Last 90d', days: 89  },
  { label: 'Last 1y',  days: 364 },
];

function DateRange({ startDate, endDate, preset, onStart, onEnd, onPreset }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => onPreset(p)}
            className={`px-3 py-2 font-medium transition-colors ${preset === p.label ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
        <Calendar className="h-3.5 w-3.5 text-gray-400" />
        <input type="date" value={startDate} max={endDate}
          onChange={(e) => onStart(e.target.value)}
          className="text-xs border-none outline-none bg-transparent" />
        <span className="text-gray-400 text-xs">—</span>
        <input type="date" value={endDate} min={startDate} max={today}
          onChange={(e) => onEnd(e.target.value)}
          className="text-xs border-none outline-none bg-transparent" />
      </div>
    </div>
  );
}

// Company filter shown to super admin on finance tabs
function CompanyPicker({ companies, value, onChange }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5">
      <Users className="h-3.5 w-3.5 text-primary-500 shrink-0" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs font-medium text-primary-800 bg-transparent border-none outline-none cursor-pointer"
      >
        <option value="">All Companies</option>
        {companies.map((c) => (
          <option key={c.company_id} value={c.company_id}>{c.company_name}</option>
        ))}
      </select>
    </div>
  );
}

function KPICard({ label, value, icon: Icon, sub, accent }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${accent ? 'border-primary-200' : 'border-gray-100'}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────

function groupTrend(trend, days) {
  if (!trend?.length) return [];
  const toDate = (s) => new Date(String(s).slice(0, 10) + 'T12:00:00');

  // 7d → daily (all labels)
  if (days <= 8) {
    return trend.map((d) => ({
      ...d,
      label: toDate(d.date).toLocaleDateString('en', { day: 'numeric', month: 'short' }),
      showLabel: true,
    }));
  }

  // 30d → weekly buckets
  if (days <= 35) {
    const map = new Map();
    for (const d of trend) {
      const dt = toDate(d.date); const dow = dt.getDay();
      const mon = new Date(dt); mon.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
      const key = mon.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, { date: key, total: 0, txnCount: 0 });
      const b = map.get(key); b.total += d.total || 0; b.txnCount += d.txnCount || 0;
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ ...v, label: toDate(key).toLocaleDateString('en', { day: 'numeric', month: 'short' }), showLabel: true }));
  }

  // 90d → monthly buckets
  if (days <= 95) {
    const map = new Map();
    for (const d of trend) {
      const key = String(d.date).slice(0, 7);
      if (!map.has(key)) map.set(key, { date: key + '-01', total: 0, txnCount: 0 });
      const b = map.get(key); b.total += d.total || 0; b.txnCount += d.txnCount || 0;
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ ...v, label: toDate(key + '-15').toLocaleDateString('en', { month: 'short' }), showLabel: true }));
  }

  // 1y → quarterly buckets
  const map = new Map();
  for (const d of trend) {
    const dt = toDate(d.date);
    const year = dt.getFullYear();
    const q = Math.floor(dt.getMonth() / 3) + 1;
    const key = `${year}-Q${q}`;
    if (!map.has(key)) map.set(key, { date: key, total: 0, txnCount: 0, year, q });
    const b = map.get(key); b.total += d.total || 0; b.txnCount += d.txnCount || 0;
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ ...v, label: `Q${v.q} '${String(v.year).slice(2)}`, showLabel: true }));
}

function BarChart({ data, height = 130 }) {
  if (!data?.length) return <div className="flex items-center justify-center h-24 text-gray-300 text-sm">No data</div>;
  const max = Math.max(...data.map((d) => d.total), 1);
  const W = 360; const count = data.length;
  const gap = count > 20 ? 1 : count > 10 ? 2 : 3;
  const barW = Math.max(2, Math.floor((W - gap * (count - 1)) / count));
  const chartH = height - 22;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} aria-hidden>
      {data.map((d, i) => {
        const bh = Math.max(2, (d.total / max) * chartH);
        const x = i * (barW + gap);
        const showLabel = d.showLabel !== undefined
          ? d.showLabel
          : count <= 10 || i % Math.ceil(count / 10) === 0 || i === count - 1;
        return (
          <g key={d.date ?? i}>
            <rect x={x} y={chartH - bh} width={barW} height={bh} rx={2} fill="#FFA916" opacity={0.85} />
            {showLabel && <text x={x + barW / 2} y={height - 4} textAnchor="middle" fontSize={8} fill="#9ca3af">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── Tab: Sales Summary ────────────────────────────────────────────────────────

function SalesTab({ isSuperAdmin, filterCompanyId, setFilterCompanyId, companies = [] }) {
  const [startDate,  setStart]    = useState(toISO(new Date(Date.now() - 29 * 86400000)));
  const [endDate,    setEnd]      = useState(today);
  const [preset,     setPreset]   = useState('Last 30d');
  const [sessionId,  setSessionId] = useState('');

  const userRole = useAuthStore((s) => s.user?.role);
  const canFilterByShift = ['company_admin', 'super_admin', 'branch_manager'].includes(userRole);

  const applyPreset = (p) => {
    const end = new Date(); const start = new Date();
    start.setDate(end.getDate() - p.days);
    setStart(toISO(start)); setEnd(toISO(end)); setPreset(p.label);
    setSessionId('');
  };

  const { data: sessionsData } = useQuery({
    queryKey: ['sales-sessions-filter', startDate, endDate],
    queryFn:  () => api.get('/pos/sessions', { params: { startDate, endDate, limit: 200 } }).then((r) => r.data.data?.sessions ?? []),
    enabled:  canFilterByShift && !isSuperAdmin,
  });
  const sessionsList = sessionsData ?? [];

  const endpoint = isSuperAdmin ? '/platform/reports/sales' : '/reports/sales';
  const params   = {
    startDate, endDate,
    ...(sessionId ? { sessionId } : {}),
    ...(isSuperAdmin && filterCompanyId ? { companyId: filterCompanyId } : {}),
  };

  const { data, isLoading, refetch: refetchSales, isFetching: isFetchingSales } = useQuery({
    queryKey: ['reports-sales', startDate, endDate, sessionId, isSuperAdmin ? (filterCompanyId || 'all') : null],
    queryFn:  () => api.get(endpoint, { params }).then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;
  const s = data?.summary;
  const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000);
  const trend = groupTrend(data?.trend ?? [], days);
  const bucketLabel = days <= 8 ? 'Daily' : days <= 35 ? 'Weekly' : days <= 95 ? 'Monthly' : 'Quarterly';

  function handlePrint() {
    const fc = (v) => formatCurrency(v ?? 0);
    const period = `${startDate} — ${endDate}`;
    let html = `
      <h2>KPI Summary</h2>
      <table><thead><tr><th>Metric</th><th class="r">Value</th></tr></thead><tbody>
        <tr><td>Total Revenue</td><td class="r b">${fc(s?.totalSales)}</td></tr>
        <tr><td>Transactions</td><td class="r">${(s?.totalTxns ?? 0).toLocaleString()}</td></tr>
        <tr><td>Average Transaction</td><td class="r">${fc(s?.avgTxn)}</td></tr>
        <tr><td>Unique Customers</td><td class="r">${(s?.uniqueCustomers ?? 0).toLocaleString()}</td></tr>
      </tbody></table>`;
    if (data?.topProducts?.length) {
      html += `<h2>Top Products</h2><table><thead><tr><th>Product</th><th>SKU</th><th class="r">Units</th><th class="r">Revenue</th></tr></thead><tbody>`;
      data.topProducts.forEach((p) => {
        html += `<tr><td>${p.productName}</td><td>${p.sku ?? ''}</td><td class="r">${p.qtySold}</td><td class="r">${fc(p.revenue)}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    if (data?.categories?.length) {
      html += `<h2>By Category</h2><table><thead><tr><th>Category</th><th class="r">Revenue</th><th class="r">Units</th></tr></thead><tbody>`;
      data.categories.forEach((c) => {
        html += `<tr><td>${c.categoryName}</td><td class="r">${fc(c.revenue)}</td><td class="r">${c.qtySold}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    printReport('Sales Report', period, html);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateRange startDate={startDate} endDate={endDate} preset={preset}
          onStart={(v) => { setStart(v); setPreset(''); setSessionId(''); }}
          onEnd={(v) => { setEnd(v); setPreset(''); setSessionId(''); }}
          onPreset={applyPreset} />
        {canFilterByShift && !isSuperAdmin && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1">
            <ShoppingCart className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="text-xs text-gray-700 bg-transparent border-none outline-none cursor-pointer max-w-[180px]"
            >
              <option value="">All Shifts</option>
              {sessionsList.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {s.terminal_name} · {new Date(s.session_start).toLocaleDateString('en', { day: 'numeric', month: 'short' })} · {s.cashier_name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isSuperAdmin && (
          <CompanyPicker companies={companies} value={filterCompanyId} onChange={setFilterCompanyId} />
        )}
        <button onClick={() => refetchSales()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingSales ? 'animate-spin' : ''}`} />Refresh
        </button>
        <button onClick={handlePrint} className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <Printer className="h-3.5 w-3.5" />Print / PDF
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard label="Total Revenue"     value={formatCurrency(s?.totalSales ?? 0)} icon={TrendingUp} accent />
        <KPICard label="Transactions"      value={(s?.totalTxns ?? 0).toLocaleString()} icon={ShoppingCart} sub={`Avg ${formatCurrency(s?.avgTxn ?? 0)}`} />
        <KPICard label="Unique Customers"  value={(s?.uniqueCustomers ?? 0).toLocaleString()} icon={Users} />
        <KPICard label="Daily Average"     value={formatCurrency(
          (data?.trend ?? []).filter((d) => d.total > 0).length
            ? (s?.totalSales ?? 0) / (data.trend.filter((d) => d.total > 0).length)
            : 0
        )} icon={BarChart2} sub={`${(data?.trend ?? []).filter((d) => d.total > 0).length} active days`} />
      </div>
      {(s?.creditSaleCount ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KPICard label="Credit Sales"   value={formatCurrency(s?.creditSaleAmount ?? 0)} icon={ShoppingCart} sub={`${s?.creditSaleCount} txn${s?.creditSaleCount !== 1 ? 's' : ''} charged to account`} />
          <KPICard label="Cash / Paid Sales" value={formatCurrency((s?.totalSales ?? 0) - (s?.creditSaleAmount ?? 0))} icon={TrendingUp} sub="Collected at counter" />
        </div>
      )}

      <SectionCard title={`Revenue Trend — ${bucketLabel} · ${trend.length} ${days <= 31 ? 'days' : days <= 89 ? 'weeks' : 'months'}`}>
        <BarChart data={trend} height={140} />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Top Products">
          {data?.topProducts?.length ? (
            <div className="space-y-2">
              {data.topProducts.map((p, i) => {
                const maxRev = data.topProducts[0]?.revenue || 1;
                return (
                  <div key={p.sku}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-gray-700 font-medium truncate">{i + 1}. {p.productName}</span>
                      <span className="text-secondary-600 font-semibold ml-2 shrink-0">{formatCurrency(p.revenue)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-secondary-400" style={{ width: `${(p.revenue / maxRev) * 100}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{p.qtySold} units</p>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-center text-gray-400 text-sm py-6">No data</p>}
        </SectionCard>

        <SectionCard title="By Category">
          {data?.categories?.length ? (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-100">
                <th className="pb-2 text-left font-medium text-gray-500">Category</th>
                <th className="pb-2 text-right font-medium text-gray-500">Revenue</th>
                <th className="pb-2 text-right font-medium text-gray-500">Units</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {data.categories.map((c) => (
                  <tr key={c.categoryName}>
                    <td className="py-1.5 text-gray-700">{c.categoryName}</td>
                    <td className="py-1.5 text-right font-semibold">{formatCurrency(c.revenue)}</td>
                    <td className="py-1.5 text-right text-gray-500">{c.qtySold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-center text-gray-400 text-sm py-6">No data</p>}
        </SectionCard>

        <SectionCard title="Cashier Performance">
          {data?.cashiers?.length ? (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-100">
                <th className="pb-2 text-left font-medium text-gray-500">Cashier</th>
                <th className="pb-2 text-right font-medium text-gray-500">TXNs</th>
                <th className="pb-2 text-right font-medium text-gray-500">Revenue</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {data.cashiers.map((c) => (
                  <tr key={c.cashierName}>
                    <td className="py-1.5 text-gray-700 font-medium">{c.cashierName}</td>
                    <td className="py-1.5 text-right text-gray-500">{c.txnCount}</td>
                    <td className="py-1.5 text-right font-semibold">{formatCurrency(c.totalSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-center text-gray-400 text-sm py-6">No data</p>}
        </SectionCard>
      </div>
    </div>
  );
}

// ── Tab: P&L Statement ────────────────────────────────────────────────────────

function PLRow({ label, value, bold, indent, positive, negative, separator }) {
  if (separator) return <tr><td colSpan={2} className="py-1"><div className="border-t border-gray-200" /></td></tr>;
  const textColor = positive ? 'text-green-700' : negative ? 'text-red-600' : 'text-gray-900';
  return (
    <tr>
      <td className={`py-1.5 text-sm ${indent ? 'pl-6' : ''} ${bold ? 'font-semibold' : 'text-gray-600'}`}>{label}</td>
      <td className={`py-1.5 text-right text-sm ${bold ? 'font-bold' : ''} ${textColor}`}>{formatCurrency(value)}</td>
    </tr>
  );
}

function PLTab({ isSuperAdmin, filterCompanyId, setFilterCompanyId, companies = [] }) {
  const [startDate, setStart] = useState(toISO(new Date(Date.now() - 29 * 86400000)));
  const [endDate,   setEnd]   = useState(today);
  const [preset,    setPreset] = useState('Last 30d');

  const applyPreset = (p) => {
    const end = new Date(); const start = new Date();
    start.setDate(end.getDate() - p.days);
    setStart(toISO(start)); setEnd(toISO(end)); setPreset(p.label);
  };

  const endpoint = isSuperAdmin ? '/platform/reports/pl' : '/reports/pl';
  const params   = { startDate, endDate, ...(isSuperAdmin && filterCompanyId ? { companyId: filterCompanyId } : {}) };

  const { data, isLoading, isError, refetch: refetchPL, isFetching: isFetchingPL } = useQuery({
    queryKey: ['reports-pl', startDate, endDate, isSuperAdmin ? (filterCompanyId || 'all') : null],
    queryFn:  () => api.get(endpoint, { params }).then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <p className="py-12 text-center text-gray-400">Failed to load P&L report. Please try again.</p>;

  const { income, cogs, grossProfit, grossMargin, operatingExpenses, operatingProfit, operatingMargin, expenseBreakdown, paymentBreakdown } = data;

  function handlePrint() {
    const fc = (v) => formatCurrency(v ?? 0);
    const period = `${startDate} — ${endDate}`;
    let html = `<h2>Income Statement</h2>
      <table><thead><tr><th>Line Item</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td>Gross Sales Revenue</td><td class="r">${fc(income.grossRevenue)}</td></tr>
        <tr><td>Less: VAT Collected</td><td class="r red">(${fc(income.taxCollected)})</td></tr>
        <tr><td>Revenue (ex-VAT)</td><td class="r">${fc(income.revenueExVat)}</td></tr>
        <tr><td>Less: Sales Returns</td><td class="r red">(${fc(income.totalReturns)})</td></tr>
        <tr><td class="b">Net Revenue</td><td class="r b">${fc(income.netRevenue)}</td></tr>
        <tr><td>Cost of Goods Sold</td><td class="r red">(${fc(cogs)})</td></tr>
        <tr><td class="b">Gross Profit</td><td class="r b ${grossProfit >= 0 ? 'grn' : 'red'}">${fc(grossProfit)} (${grossMargin.toFixed(1)}%)</td></tr>
        <tr><td>Operating Expenses</td><td class="r red">(${fc(operatingExpenses)})</td></tr>
        <tr><td class="b">Operating Profit</td><td class="r b ${operatingProfit >= 0 ? 'grn' : 'red'}">${fc(operatingProfit)} (${operatingMargin.toFixed(1)}%)</td></tr>
      </tbody></table>`;
    if (expenseBreakdown?.length) {
      html += `<h2>Expense Breakdown</h2><table><thead><tr><th>Account</th><th class="r">Code</th><th class="r">Amount</th></tr></thead><tbody>`;
      expenseBreakdown.forEach((e) => {
        html += `<tr><td>${e.accountName}</td><td class="r">${e.accountCode}</td><td class="r red">${fc(e.amount)}</td></tr>`;
      });
      html += `<tfoot><tr><td colspan="2">Total</td><td class="r">${fc(operatingExpenses)}</td></tr></tfoot></table>`;
    }
    printReport('Profit & Loss Statement', period, html);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateRange startDate={startDate} endDate={endDate} preset={preset}
          onStart={(v) => { setStart(v); setPreset(''); }}
          onEnd={(v) => { setEnd(v); setPreset(''); }}
          onPreset={applyPreset} />
        {isSuperAdmin && (
          <CompanyPicker companies={companies} value={filterCompanyId} onChange={setFilterCompanyId} />
        )}
        <button onClick={() => refetchPL()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingPL ? 'animate-spin' : ''}`} />Refresh
        </button>
        <button onClick={handlePrint} className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <Printer className="h-3.5 w-3.5" />Print / PDF
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard label="Net Revenue (ex-VAT)" value={formatCurrency(income.netRevenue)} icon={TrendingUp} accent />
        <KPICard label="Gross Profit"   value={formatCurrency(grossProfit)}  icon={BarChart2}
          sub={`${grossMargin.toFixed(1)}% margin`} />
        <KPICard label="Operating Profit" value={formatCurrency(operatingProfit)} icon={Scale}
          sub={`${operatingMargin.toFixed(1)}% margin`} />
        <KPICard label="Returns"        value={formatCurrency(income.totalReturns)} icon={AlertTriangle}
          sub={`${income.returnCount} returns`} />
      </div>

      {(income.creditSaleCount ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KPICard label="Credit Sales" value={formatCurrency(income.creditSaleAmount)} icon={ShoppingCart}
            sub={`${income.creditSaleCount} txn${income.creditSaleCount !== 1 ? 's' : ''} — charged to account`} />
          <KPICard label="Cash / Paid Sales" value={formatCurrency(income.grossRevenue - income.creditSaleAmount)} icon={TrendingUp}
            sub="Collected at counter" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Full Income Statement */}
        <SectionCard title="Income Statement">
          <table className="w-full">
            <tbody>
              <tr><td colSpan={2} className="pb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Revenue</td></tr>
              <PLRow label="Gross Sales Revenue"      value={income.grossRevenue} />
              <PLRow label="Less: VAT Collected"      value={-income.taxCollected} indent negative={income.taxCollected > 0} />
              <PLRow label="Revenue (ex-VAT)"         value={income.revenueExVat} bold />
              <PLRow label="Less: Sales Returns"      value={-income.totalReturns} indent negative={income.totalReturns > 0} />
              <PLRow label="Net Revenue"              value={income.netRevenue} bold positive={income.netRevenue > 0} />
              <PLRow separator />
              <tr><td colSpan={2} className="py-1 text-xs font-bold uppercase tracking-widest text-gray-400">Cost of Goods Sold</td></tr>
              <PLRow label="Cost of Goods Sold"       value={-cogs} indent negative={cogs > 0} />
              <PLRow separator />
              <PLRow label="Gross Profit"             value={grossProfit} bold positive={grossProfit > 0} negative={grossProfit < 0} />
              <tr>
                <td className="pb-1 text-xs text-gray-400">Gross Margin</td>
                <td className={`pb-1 text-right text-xs font-semibold ${grossMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {grossMargin.toFixed(2)}%
                </td>
              </tr>
              <PLRow separator />
              <tr><td colSpan={2} className="py-1 text-xs font-bold uppercase tracking-widest text-gray-400">Operating Expenses</td></tr>
              <PLRow label="Operating Expenses" value={-operatingExpenses} indent negative={operatingExpenses > 0} />
              <PLRow separator />
              <PLRow label="Operating Profit"         value={operatingProfit} bold positive={operatingProfit > 0} negative={operatingProfit < 0} />
              <tr>
                <td className="pt-1 text-xs text-gray-400">Operating Margin</td>
                <td className={`pt-1 text-right text-xs font-semibold ${operatingMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {operatingMargin.toFixed(2)}%
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-400 italic">
            COGS = qty sold × product cost price. Operating expenses = all supplier payments in period.
          </p>
        </SectionCard>

        <div className="space-y-5">
          {/* Revenue by Payment Method */}
          <SectionCard title="Revenue by Payment Method">
            {paymentBreakdown?.length ? (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100">
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Method</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">TXNs</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Share</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {paymentBreakdown.map((p) => (
                    <tr key={p.method}>
                      <td className="py-1.5 text-gray-700 font-medium">{p.method}</td>
                      <td className="py-1.5 text-right text-gray-500">{p.txnCount}</td>
                      <td className="py-1.5 text-right font-semibold">{formatCurrency(p.amount)}</td>
                      <td className="py-1.5 text-right text-gray-400 text-xs">
                        {income.grossRevenue > 0 ? ((p.amount / income.grossRevenue) * 100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-center text-gray-400 text-sm py-6">No payment data</p>}
          </SectionCard>

          {/* Expense Breakdown by Account */}
          {expenseBreakdown?.length > 0 && (
            <SectionCard title="Expense Accounts">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100">
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Account</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Code</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Amount</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {expenseBreakdown.map((e) => (
                    <tr key={e.accountCode}>
                      <td className="py-1.5 text-gray-700 font-medium">{e.accountName}</td>
                      <td className="py-1.5 text-right text-gray-500">{e.accountCode}</td>
                      <td className="py-1.5 text-right font-semibold text-red-600">{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200">
                  <tr>
                    <td colSpan={2} className="pt-2 text-xs font-bold text-gray-700">Total</td>
                    <td className="pt-2 text-right text-xs font-bold text-red-600">{formatCurrency(operatingExpenses)}</td>
                  </tr>
                </tfoot>
              </table>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab: AP Aging ─────────────────────────────────────────────────────────────

const AGING_BUCKETS = [
  { key: 'current', label: '0–30 days',  color: 'bg-green-100 text-green-700' },
  { key: '31_60',   label: '31–60 days', color: 'bg-amber-100 text-amber-700' },
  { key: '61_90',   label: '61–90 days', color: 'bg-orange-100 text-orange-700' },
  { key: 'over_90', label: '90+ days',   color: 'bg-red-100 text-red-700' },
];

function APAgingTab({ isSuperAdmin, filterCompanyId, setFilterCompanyId, companies = [] }) {
  const endpoint = isSuperAdmin ? '/platform/reports/ap-aging' : '/reports/ap-aging';
  const params   = isSuperAdmin && filterCompanyId ? { companyId: filterCompanyId } : {};

  const { data, isLoading, isError, refetch: refetchAP, isFetching: isFetchingAP } = useQuery({
    queryKey: ['reports-ap-aging', isSuperAdmin ? (filterCompanyId || 'all') : null],
    queryFn:  () => api.get(endpoint, { params }).then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <p className="py-12 text-center text-gray-400">Failed to load AP Aging report. Please try again.</p>;

  const { suppliers, totals } = data;

  function handlePrint() {
    const fc = (v) => formatCurrency(v ?? 0);
    let html = `<h2>Summary</h2>
      <table><thead><tr><th>Bucket</th><th class="r">Amount</th></tr></thead><tbody>
        ${AGING_BUCKETS.map((b) => `<tr><td>${b.label}</td><td class="r">${fc(totals[b.key])}</td></tr>`).join('')}
        <tr class="b"><td>Total</td><td class="r">${fc(totals.total)}</td></tr>
      </tbody></table>`;
    if (suppliers.length) {
      html += `<h2>Outstanding AP — ${suppliers.length} suppliers</h2>
        <table><thead><tr><th>Supplier</th><th>Oldest Invoice</th><th class="r">Days</th><th>Bucket</th><th class="r">Balance</th></tr></thead><tbody>`;
      suppliers.forEach((s) => {
        const b = AGING_BUCKETS.find((bk) => bk.key === s.bucket) ?? AGING_BUCKETS[0];
        html += `<tr><td>${s.supplierName}</td><td>${s.oldestInvoice ?? '—'}</td><td class="r">${s.daysOutstanding ?? '—'}</td><td>${b.label}</td><td class="r red">${fc(s.balance)}</td></tr>`;
      });
      html += `<tfoot><tr><td colspan="4">Total AP Outstanding</td><td class="r">${fc(totals.total)}</td></tr></tfoot></table>`;
    }
    printReport('AP Aging Report', `As of ${today}`, html);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {isSuperAdmin && (
          <CompanyPicker companies={companies} value={filterCompanyId} onChange={setFilterCompanyId} />
        )}
        <button onClick={() => refetchAP()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingAP ? 'animate-spin' : ''}`} />Refresh
        </button>
        <button onClick={handlePrint} className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <Printer className="h-3.5 w-3.5" />Print / PDF
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {AGING_BUCKETS.map((b) => (
          <div key={b.key} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${b.color}`}>{b.label}</span>
            <p className="mt-2 text-xl font-bold text-gray-900">{formatCurrency(totals[b.key])}</p>
          </div>
        ))}
      </div>

      <SectionCard title={`Outstanding AP — ${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''}`}>
        {suppliers.length === 0 ? (
          <p className="text-center text-gray-400 py-6">No outstanding balances</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Oldest Invoice</th>
                  <th className="pb-2 text-center text-xs font-medium text-gray-500">Days Out</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Bucket</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {suppliers.map((s) => {
                  const bucket = AGING_BUCKETS.find((b) => b.key === s.bucket) ?? AGING_BUCKETS[0];
                  return (
                    <tr key={s.supplierId}>
                      <td className="py-2">
                        <p className="font-medium text-gray-900">{s.supplierName}</p>
                        <p className="text-xs text-gray-400">{s.phone || s.email || ''}</p>
                      </td>
                      <td className="py-2 text-gray-500 text-xs">{s.oldestInvoice ?? '—'}</td>
                      <td className="py-2 text-center font-mono text-sm">
                        {s.daysOutstanding !== null ? s.daysOutstanding : '—'}
                      </td>
                      <td className="py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${bucket.color}`}>
                          {bucket.label}
                        </span>
                      </td>
                      <td className="py-2 text-right font-semibold text-red-600">{formatCurrency(s.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-gray-300">
                <tr>
                  <td colSpan={4} className="pt-2 text-sm font-bold text-gray-700">Total AP Outstanding</td>
                  <td className="pt-2 text-right text-sm font-bold text-red-600">{formatCurrency(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab: Balance Sheet ────────────────────────────────────────────────────────

function BSRow({ label, value, indent, bold, highlight }) {
  return (
    <div className={`flex justify-between py-1.5 text-sm ${indent ? 'pl-4' : ''} ${bold ? 'border-t border-gray-200 mt-1 pt-2' : ''}`}>
      <span className={bold ? 'font-bold text-gray-900' : indent ? 'text-gray-600' : 'font-medium text-gray-800'}>{label}</span>
      <span className={`font-${bold ? 'bold' : 'semibold'} ${highlight === 'pos' ? 'text-green-700' : highlight === 'neg' ? 'text-red-600' : 'text-gray-900'}`}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function BalanceSheetTab({ isSuperAdmin, filterCompanyId, setFilterCompanyId, companies = [] }) {
  const endpoint = isSuperAdmin ? '/platform/reports/balance-sheet' : '/reports/balance-sheet';
  const params   = isSuperAdmin && filterCompanyId ? { companyId: filterCompanyId } : {};

  const { data, isLoading, isError, refetch: refetchBS, isFetching: isFetchingBS } = useQuery({
    queryKey: ['reports-balance-sheet', isSuperAdmin ? (filterCompanyId || 'all') : null],
    queryFn:  () => api.get(endpoint, { params }).then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <p className="py-12 text-center text-gray-400">Failed to load Balance Sheet. Please try again.</p>;

  const { assets, liabilities, equity } = data;

  function handlePrint() {
    const fc = (v) => formatCurrency(v ?? 0);
    let html = `<h2>Assets</h2>
      <table><thead><tr><th>Item</th><th class="r">Amount</th></tr></thead><tbody>`;
    assets.cashAndBank.accounts.forEach((a) => {
      html += `<tr><td style="padding-left:16px">${a.account_name} (${a.bank_name})</td><td class="r">${fc(a.balance)}</td></tr>`;
    });
    html += `<tr class="b"><td>Total Cash & Bank</td><td class="r">${fc(assets.cashAndBank.total)}</td></tr>
      <tr><td style="padding-left:16px">Inventory (${assets.inventory.totalUnits.toFixed(0)} units)</td><td class="r">${fc(assets.inventory.total)}</td></tr>
      <tr class="b"><td>TOTAL ASSETS</td><td class="r">${fc(assets.total)}</td></tr>
      </tbody></table>
      <h2>Liabilities</h2>
      <table><thead><tr><th>Supplier</th><th class="r">Balance</th></tr></thead><tbody>`;
    liabilities.accountsPayable.suppliers.forEach((s) => {
      html += `<tr><td>${s.supplierName}</td><td class="r red">${fc(s.balance)}</td></tr>`;
    });
    html += `<tr class="b"><td>TOTAL LIABILITIES</td><td class="r red">${fc(liabilities.total)}</td></tr>
      </tbody></table>
      <h2>Equity</h2>
      <table><tbody>
        <tr class="b"><td>Net Equity (Assets − Liabilities)</td><td class="r ${equity >= 0 ? 'grn' : 'red'}">${fc(equity)}</td></tr>
      </tbody></table>`;
    printReport('Balance Sheet', `As of ${data.asOf}`, html);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Snapshot as of <strong>{data.asOf}</strong></p>
        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <CompanyPicker companies={companies} value={filterCompanyId} onChange={setFilterCompanyId} />
          )}
          <button onClick={() => refetchBS()}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetchingBS ? 'animate-spin' : ''}`} />Refresh
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <Printer className="h-3.5 w-3.5" />Print / PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard label="Total Assets"      value={formatCurrency(assets.total)}      icon={Scale}   accent />
        <KPICard label="Total Liabilities" value={formatCurrency(liabilities.total)} icon={AlertTriangle} />
        <KPICard label="Equity"            value={formatCurrency(equity)}            icon={TrendingUp} />
        <KPICard label="Inventory Value"   value={formatCurrency(assets.inventory.total)} icon={Package}
          sub={`${assets.inventory.productCount} products`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Assets */}
        <SectionCard title="Assets">
          <div className="space-y-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Cash & Bank</p>
            {assets.cashAndBank.accounts.map((a) => (
              <BSRow key={a.account_number} label={`${a.account_name} (${a.bank_name})`} value={a.balance} indent />
            ))}
            {assets.cashAndBank.accounts.length === 0 && <p className="text-xs text-gray-400 pl-4">No bank accounts</p>}
            <BSRow label="Total Cash & Bank" value={assets.cashAndBank.total} bold />

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-4 mb-2">Inventory</p>
            <BSRow label={`Stock (${assets.inventory.totalUnits.toFixed(0)} units)`} value={assets.inventory.total} indent />
            <BSRow label="Total Inventory" value={assets.inventory.total} bold />

            <div className="mt-4 rounded-lg bg-primary-50 px-4 py-3 flex justify-between">
              <span className="text-sm font-bold text-primary-800">TOTAL ASSETS</span>
              <span className="text-sm font-bold text-primary-800">{formatCurrency(assets.total)}</span>
            </div>
          </div>
        </SectionCard>

        {/* Liabilities + Equity */}
        <div className="space-y-5">
          <SectionCard title="Liabilities">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Accounts Payable</p>
            {liabilities.accountsPayable.suppliers.map((s) => (
              <BSRow key={s.supplierName} label={s.supplierName} value={s.balance} indent />
            ))}
            {liabilities.accountsPayable.suppliers.length === 0 && <p className="text-xs text-gray-400 pl-4">No outstanding balances</p>}
            <BSRow label="Total AP" value={liabilities.accountsPayable.total} bold />
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 flex justify-between">
              <span className="text-sm font-bold text-red-800">TOTAL LIABILITIES</span>
              <span className="text-sm font-bold text-red-800">{formatCurrency(liabilities.total)}</span>
            </div>
          </SectionCard>

          <SectionCard title="Equity">
            <div className={`rounded-lg px-4 py-4 flex justify-between ${equity >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <span className={`text-base font-bold ${equity >= 0 ? 'text-green-800' : 'text-red-800'}`}>Net Equity (Assets − Liabilities)</span>
              <span className={`text-base font-bold ${equity >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatCurrency(equity)}</span>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Cash Flow ────────────────────────────────────────────────────────────

function CashFlowTab({ isSuperAdmin, filterCompanyId, setFilterCompanyId, companies = [] }) {
  const [startDate, setStart] = useState(toISO(new Date(Date.now() - 29 * 86400000)));
  const [endDate,   setEnd]   = useState(today);
  const [preset,    setPreset] = useState('Last 30d');

  const applyPreset = (p) => {
    const end = new Date(); const start = new Date();
    start.setDate(end.getDate() - p.days);
    setStart(toISO(start)); setEnd(toISO(end)); setPreset(p.label);
  };

  const endpoint = isSuperAdmin ? '/platform/reports/cash-flow' : '/reports/cash-flow';
  const params   = { startDate, endDate, ...(isSuperAdmin && filterCompanyId ? { companyId: filterCompanyId } : {}) };

  const { data, isLoading, isError, refetch: refetchCF, isFetching: isFetchingCF } = useQuery({
    queryKey: ['reports-cashflow', startDate, endDate, isSuperAdmin ? (filterCompanyId || 'all') : null],
    queryFn:  () => api.get(endpoint, { params }).then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <p className="py-12 text-center text-gray-400">Failed to load Cash Flow statement. Please try again.</p>;
  const d = data ?? {};
  const op = d.operating ?? {};
  const fi = d.financing ?? {};

  function handlePrint() {
    const fc = (v) => { const n = v ?? 0; return n < 0 ? `(${formatCurrency(Math.abs(n))})` : formatCurrency(n); };
    const period = `${startDate} — ${endDate}`;
    const html = `
      <h2>Operating Activities</h2>
      <table><tbody>
        <tr><td style="padding-left:16px">Receipts from customers</td><td class="r">${fc(op.receiptsFromCustomers)}</td></tr>
        <tr><td style="padding-left:16px">Refunds to customers</td><td class="r">${fc(op.refundsToCustomers)}</td></tr>
        <tr><td style="padding-left:16px">Payments to suppliers</td><td class="r">${fc(op.paymentsToSuppliers)}</td></tr>
        <tr class="b"><td>Net Operating Cash Flow</td><td class="r ${(op.net ?? 0) >= 0 ? 'grn' : 'red'}">${fc(op.net)}</td></tr>
      </tbody></table>
      <h2>Cash Position</h2>
      <table><tbody>
        <tr><td>Opening Balance</td><td class="r">${fc(d.openingBalance)}</td></tr>
        <tr><td>Net Cash Change</td><td class="r">${fc(d.netCashChange)}</td></tr>
        <tr class="b"><td>Closing Balance</td><td class="r ${(d.closingBalance ?? 0) >= 0 ? 'grn' : 'red'}">${fc(d.closingBalance)}</td></tr>
      </tbody></table>`;
    printReport('Cash Flow Statement', period, html);
  }

  const Row = ({ label, value, indent, bold, positive }) => (
    <div className={`flex justify-between py-1.5 border-b border-gray-100 last:border-0 ${bold ? 'font-semibold' : ''} ${indent ? 'pl-5' : ''}`}>
      <span className={bold ? 'text-gray-900' : 'text-gray-600'}>{label}</span>
      <span className={value >= 0 ? (positive ? 'text-green-700' : 'text-gray-900') : 'text-red-600'}>
        {value >= 0 ? formatCurrency(value) : `(${formatCurrency(Math.abs(value))})`}
      </span>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <DateRange startDate={startDate} endDate={endDate} preset={preset}
          onStart={(v) => { setStart(v); setPreset(''); }}
          onEnd={(v)   => { setEnd(v);   setPreset(''); }}
          onPreset={applyPreset} />
        {isSuperAdmin && (
          <CompanyPicker companies={companies} value={filterCompanyId} onChange={setFilterCompanyId} />
        )}
        <button onClick={() => refetchCF()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingCF ? 'animate-spin' : ''}`} />Refresh
        </button>
        <button onClick={handlePrint} className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <Printer className="h-3.5 w-3.5" />Print / PDF
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard label="Opening Cash"  value={formatCurrency(d.openingBalance  ?? 0)} icon={Droplets} />
        <KPICard label="Net Cash Flow" value={formatCurrency(d.netCashChange   ?? 0)} icon={ArrowUpRight}
          accent={d.netCashChange >= 0} sub={d.netCashChange >= 0 ? 'Positive' : 'Negative'} />
        <KPICard label="Closing Cash"  value={formatCurrency(d.closingBalance  ?? 0)} icon={CreditCard} accent />
        <KPICard label="From Operations" value={formatCurrency(op.net ?? 0)} icon={TrendingUp}
          sub={op.net >= 0 ? 'Operating surplus' : 'Operating deficit'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Operating Activities">
          <Row label="Receipts from customers"   value={op.receiptsFromCustomers ?? 0} indent />
          {(op.arCollections ?? 0) > 0 && <Row label="AR collections"  value={op.arCollections ?? 0} indent />}
          <Row label="Refunds to customers"      value={op.refundsToCustomers    ?? 0} indent />
          <Row label="Payments to suppliers"     value={op.paymentsToSuppliers   ?? 0} indent />
          {(op.supplierPaymentVoids ?? 0) !== 0 &&
            <Row label="Supplier payment reversals" value={op.supplierPaymentVoids ?? 0} indent />}
          <Row label="Net Operating Cash Flow"   value={op.net ?? 0} bold positive />
        </SectionCard>

        <SectionCard title="Financing Activities">
          {(fi.openingDeposits ?? 0) !== 0 &&
            <Row label="Opening equity deposits" value={fi.openingDeposits ?? 0} indent />}
          <Row label="Net Financing Cash Flow"   value={fi.net ?? 0} bold positive />
          {(d.other?.net ?? 0) !== 0 && (
            <>
              <div className="pt-2 mt-2 border-t border-gray-100">
                <Row label="Other / Manual" value={d.other.net} indent />
              </div>
            </>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Cash Position">
        <div className="space-y-0">
          <Row label="Opening Balance"  value={d.openingBalance  ?? 0} />
          <Row label="Net Cash Change"  value={d.netCashChange   ?? 0} bold />
          <div className="border-t-2 border-gray-300 mt-1 pt-1">
            <Row label="Closing Balance" value={d.closingBalance ?? 0} bold positive />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Tab: AR Aging ─────────────────────────────────────────────────────────────

function ARAgingTab({ isSuperAdmin, filterCompanyId, setFilterCompanyId, companies = [] }) {
  const [settling, setSettling] = useState(null);
  const [settleAmt, setSettleAmt] = useState('');
  const [pmId, setPmId] = useState('');
  const qc = useQueryClient();

  const endpoint = isSuperAdmin ? '/platform/reports/ar-aging' : '/journal/ar-aging';
  const params   = isSuperAdmin && filterCompanyId ? { companyId: filterCompanyId } : {};

  const { data, isLoading, refetch, isFetching: isFetchingAR } = useQuery({
    queryKey: ['ar-aging', isSuperAdmin ? (filterCompanyId || 'all') : null],
    queryFn:  () => api.get(endpoint, { params }).then((r) => r.data.data),
  });

  const { data: paymentMethods = [] } = useQuery({
    queryKey: ['payment-methods'],
    queryFn:  () => api.get('/pos/payment-methods').then((r) => r.data.data ?? []),
  });

  const { mutate: settle, isPending } = useMutation({
    mutationFn: (body) => api.post('/journal/ar-settlement', body),
    onSuccess: () => {
      toast.success('AR settlement recorded');
      setSettling(null); setSettleAmt('');
      qc.invalidateQueries({ queryKey: ['ar-aging'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  if (isLoading) return <PageSpinner />;
  const { receivables = [], totals = {} } = data ?? {};

  const bucketColor = (b) => ({
    current: 'bg-green-100 text-green-700',
    '31_60': 'bg-yellow-100 text-yellow-700',
    '61_90': 'bg-orange-100 text-orange-700',
    over_90: 'bg-red-100 text-red-700',
  }[b] ?? 'bg-gray-100 text-gray-600');

  const bucketLabel = (b) => ({ current: '0–30d', '31_60': '31–60d', '61_90': '61–90d', over_90: '>90d' }[b] ?? b);

  function handlePrint() {
    const fc = (v) => formatCurrency(v ?? 0);
    let html = `<h2>Summary</h2>
      <table><tbody>
        <tr><td>Total AR</td><td class="r">${fc(totals.total)}</td></tr>
        <tr><td>Current (0–30d)</td><td class="r">${fc(totals.current)}</td></tr>
        <tr><td>31–60 days</td><td class="r">${fc(totals['31_60'])}</td></tr>
        <tr><td>61–90 days</td><td class="r">${fc(totals['61_90'])}</td></tr>
        <tr><td>Over 90 days</td><td class="r red">${fc(totals.over_90)}</td></tr>
      </tbody></table>`;
    if (receivables.length) {
      html += `<h2>Outstanding Receivables</h2>
        <table><thead><tr><th>Invoice</th><th>Customer</th><th class="r">Date</th><th class="r">Days</th><th class="r">Original</th><th class="r">Outstanding</th></tr></thead><tbody>`;
      receivables.forEach((r) => {
        html += `<tr><td>${r.transactionNumber}</td><td>${r.customerName}</td><td class="r">${formatDate(r.transactionDate)}</td><td class="r">${r.daysOutstanding}</td><td class="r">${fc(r.arCreated)}</td><td class="r b">${fc(r.outstanding)}</td></tr>`;
      });
      html += `<tfoot><tr><td colspan="5">Total</td><td class="r">${fc(totals.total)}</td></tr></tfoot></table>`;
    }
    printReport('AR Aging Report', `As of ${today}`, html);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {isSuperAdmin && (
          <CompanyPicker companies={companies} value={filterCompanyId} onChange={setFilterCompanyId} />
        )}
        <button onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingAR ? 'animate-spin' : ''}`} />Refresh
        </button>
        <button onClick={handlePrint} className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <Printer className="h-3.5 w-3.5" />Print / PDF
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard label="Total AR"    value={formatCurrency(totals.total   ?? 0)} icon={AlertTriangle} accent />
        <KPICard label="Current"     value={formatCurrency(totals.current ?? 0)} icon={TrendingUp} />
        <KPICard label="31–90 days"  value={formatCurrency((totals['31_60'] ?? 0) + (totals['61_90'] ?? 0))} icon={ShoppingCart} />
        <KPICard label="Over 90d"    value={formatCurrency(totals.over_90 ?? 0)} icon={AlertTriangle} />
      </div>

      {receivables.length === 0 ? (
        <SectionCard title="Accounts Receivable">
          <p className="text-center text-gray-400 py-8">No outstanding receivables</p>
        </SectionCard>
      ) : (
        <SectionCard title={`Outstanding Receivables — ${receivables.length} invoices`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Invoice</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Customer</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Date</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Days</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Original</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Settled</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Outstanding</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {receivables.map((r) => (
                  <tr key={r.transactionId} className="hover:bg-gray-50">
                    <td className="py-2 font-mono text-xs text-primary-700">{r.transactionNumber}</td>
                    <td className="py-2 text-gray-700">{r.customerName}</td>
                    <td className="py-2 text-right text-gray-500 text-xs">{formatDate(r.transactionDate)}</td>
                    <td className="py-2 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${bucketColor(r.bucket)}`}>
                        {r.daysOutstanding}d ({bucketLabel(r.bucket)})
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-500">{formatCurrency(r.arCreated)}</td>
                    <td className="py-2 text-right text-green-600">{r.arSettled > 0 ? formatCurrency(r.arSettled) : '—'}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(r.outstanding)}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => { setSettling(r); setSettleAmt(r.outstanding.toFixed(2)); setPmId(''); }}
                        className="rounded px-2 py-1 text-xs font-medium bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors">
                        Collect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* AR Settlement Modal */}
      {settling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900">Collect AR Payment</h2>
            <p className="text-sm text-gray-600">Invoice: <span className="font-mono font-semibold">{settling.transactionNumber}</span></p>
            <p className="text-sm text-gray-600">Outstanding: <span className="font-semibold text-red-600">{formatCurrency(settling.outstanding)}</span></p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700">Amount Received</label>
                <input type="number" value={settleAmt} onChange={(e) => setSettleAmt(e.target.value)} step="0.01"
                  max={settling.outstanding}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Payment Method</label>
                <select value={pmId} onChange={(e) => setPmId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none">
                  <option value="">Cash (default)</option>
                  {paymentMethods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setSettling(null)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button disabled={isPending || !settleAmt || parseFloat(settleAmt) <= 0}
                onClick={() => settle({ transactionId: settling.transactionId, amount: parseFloat(settleAmt), paymentMethodId: pmId || undefined })}
                className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {isPending ? 'Posting…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Stock Valuation ──────────────────────────────────────────────────────

function StockTab() {
  const [branchId, setBranchId] = useState('');

  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/branches').then((r) => r.data.data ?? []) });

  const { data, isLoading, refetch: refetchStock, isFetching: isFetchingStock } = useQuery({
    queryKey: ['reports-stock', branchId],
    queryFn:  () => api.get('/reports/stock-valuation', { params: branchId ? { branchId } : {} }).then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;

  const { items = [], totalValue = 0, totalUnits = 0 } = data ?? {};
  const belowReorder = items.filter((i) => i.belowReorder);
  const branchLabel = branchId ? (branches.find((b) => b.branch_id === branchId)?.branch_name ?? branchId) : 'All Branches';

  function handlePrint() {
    const fc = (v) => formatCurrency(v ?? 0);
    let html = `<h2>Summary</h2>
      <table><tbody>
        <tr><td>Total Stock Value</td><td class="r b">${fc(totalValue)}</td></tr>
        <tr><td>Total Units</td><td class="r">${totalUnits.toLocaleString()}</td></tr>
        <tr><td>Below Reorder Level</td><td class="r">${belowReorder.length}</td></tr>
      </tbody></table>
      <h2>Stock by Product</h2>
      <table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Branch</th><th class="r">Qty</th><th class="r">Unit Cost</th><th class="r">Total Value</th></tr></thead><tbody>`;
    items.forEach((item) => {
      html += `<tr${item.belowReorder ? ' style="background:#fffbeb"' : ''}><td>${item.productName}</td><td>${item.sku ?? ''}</td><td>${item.category ?? ''}</td><td>${item.branchName ?? ''}</td><td class="r">${item.qty.toLocaleString()} ${item.uom}</td><td class="r">${item.unitCost > 0 ? fc(item.unitCost) : '—'}</td><td class="r">${item.totalValue > 0 ? fc(item.totalValue) : '—'}</td></tr>`;
    });
    html += `<tfoot><tr><td colspan="6">Total</td><td class="r">${fc(totalValue)}</td></tr></tfoot></table>`;
    printReport('Stock Valuation Report', branchLabel, html);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
          value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
        </select>
        <button onClick={() => refetchStock()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetchingStock ? 'animate-spin' : ''}`} />Refresh
        </button>
        <button onClick={handlePrint} className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <Printer className="h-3.5 w-3.5" />Print / PDF
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KPICard label="Total Stock Value"   value={formatCurrency(totalValue)} icon={Package} accent />
        <KPICard label="Total Units"         value={totalUnits.toLocaleString()} icon={BarChart2} />
        <KPICard label="Below Reorder Level" value={belowReorder.length} icon={AlertTriangle}
          sub={belowReorder.length > 0 ? 'Needs restocking' : 'All adequately stocked'} />
      </div>

      <SectionCard title={`Stock by Product — ${items.length} lines`}>
        {items.length === 0 ? (
          <p className="text-center text-gray-400 py-6">No inventory data</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Product</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Category</th>
                  {!branchId && <th className="pb-2 text-left text-xs font-medium text-gray-500">Branch</th>}
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Qty</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Unit Cost</th>
                  <th className="pb-2 text-right text-xs font-medium text-gray-500">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={`${item.productId}-${item.branchId}`}
                    className={item.belowReorder ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                    <td className="py-2">
                      <p className="font-medium text-gray-900">{item.productName}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{item.category}</td>
                    {!branchId && <td className="py-2 text-gray-500 text-xs">{item.branchName}</td>}
                    <td className="py-2 text-right">
                      <span className={item.belowReorder ? 'text-amber-600 font-semibold' : 'text-gray-700'}>
                        {item.qty.toLocaleString()} {item.uom}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-500">{item.unitCost > 0 ? formatCurrency(item.unitCost) : '—'}</td>
                    <td className="py-2 text-right font-semibold">{item.totalValue > 0 ? formatCurrency(item.totalValue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-300">
                <tr>
                  <td colSpan={branchId ? 3 : 4} className="pt-2 text-sm font-bold text-gray-700">Total</td>
                  <td className="pt-2 text-right text-sm font-bold">{formatCurrency(totalValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const ALL_TABS = [
  { id: 'sales',          label: 'Sales',          icon: TrendingUp,    finance: false, group: null              },
  { id: 'stock',          label: 'Stock Value',    icon: Package,       finance: false, group: null              },
  { id: 'pl',             label: 'P&L',            icon: FileText,      finance: true,  group: 'Finance Reports' },
  { id: 'cash-flow',      label: 'Cash Flow',      icon: Droplets,      finance: true,  group: 'Finance Reports' },
  { id: 'ar-aging',       label: 'AR Aging',       icon: ArrowDownLeft, finance: true,  group: 'Finance Reports' },
  { id: 'ap-aging',       label: 'AP Aging',       icon: AlertTriangle, finance: true,  group: 'Finance Reports' },
  { id: 'balance-sheet',  label: 'Balance Sheet',  icon: Scale,         finance: true,  group: 'Finance Reports' },
];

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'super_admin';
  const hasFinance = isSuperAdmin ||
    (!!user?.planFeatures?.hasFinance && user?.role !== 'branch_manager');

  const [filterCompanyId, setFilterCompanyId] = useState('');

  const { data: companiesData } = useQuery({
    queryKey: ['platform-companies-filter'],
    queryFn:  () => api.get('/platform/companies', { params: { limit: 200 } }).then((r) => r.data.data?.companies ?? []),
    enabled:  isSuperAdmin,
    staleTime: 5 * 60_000,
  });
  const companies = companiesData ?? [];

  const validIds = ALL_TABS.filter((t) => !t.finance || hasFinance).map((t) => t.id);
  const urlTab = searchParams.get('tab');
  const tab = validIds.includes(urlTab) ? urlTab : 'sales';

  const setTab = (id) => setSearchParams({ tab: id }, { replace: true });

  const saProps = isSuperAdmin
    ? { isSuperAdmin: true, filterCompanyId, setFilterCompanyId, companies }
    : {};

  return (
    <div className="space-y-5">
      {tab === 'sales'         && <SalesTab {...saProps} />}
      {tab === 'pl'            && <PLTab {...saProps} />}
      {tab === 'cash-flow'     && <CashFlowTab {...saProps} />}
      {tab === 'ar-aging'      && <ARAgingTab {...saProps} />}
      {tab === 'ap-aging'      && <APAgingTab {...saProps} />}
      {tab === 'balance-sheet' && <BalanceSheetTab {...saProps} />}
      {tab === 'stock'         && <StockTab />}
    </div>
  );
}
