import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, ShoppingCart, Users, Package,
  ArrowUpRight, AlertTriangle, Star, Building2,
  GitBranch, UserCheck, Monitor, DollarSign,
  Activity, Settings, PlusCircle, ChevronRight,
  Globe, BarChart3, CreditCard, Layers,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/app/store';
import { formatCurrency, formatDateTime } from '@/utils/formatters';
import { usePermission } from '@/hooks/usePermission';
import { PageSpinner } from '@/components/ui/Spinner';

// ── Trend grouping helper ──────────────────────────────────────────────────────
// Aggregates daily trend rows into day / week / month buckets based on range length.
// Each output item: { date, total, txnCount, label }
function groupTrend(trend, days) {
  if (!trend?.length) return [];
  const toDate = (s) => new Date(String(s).slice(0, 10) + 'T12:00:00');

  if (days <= 31) {
    // Daily — label: "5 Jan"
    return trend.map((d) => ({
      ...d,
      label: toDate(d.date).toLocaleDateString('en', { day: 'numeric', month: 'short' }),
    }));
  }

  if (days <= 89) {
    // Weekly — bucket by Monday
    const map = new Map();
    for (const d of trend) {
      const dt = toDate(d.date);
      const dow = dt.getDay(); // 0=Sun
      const diff = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(dt);
      mon.setDate(dt.getDate() + diff);
      const key = mon.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, { date: key, total: 0, txnCount: 0 });
      const b = map.get(key);
      b.total    += d.total    || 0;
      b.txnCount += d.txnCount || 0;
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        ...v,
        label: toDate(key).toLocaleDateString('en', { day: 'numeric', month: 'short' }),
      }));
  }

  // Monthly — label: "Jan '25"
  const map = new Map();
  for (const d of trend) {
    const key = String(d.date).slice(0, 7); // "2025-01"
    if (!map.has(key)) map.set(key, { date: key + '-01', total: 0, txnCount: 0 });
    const b = map.get(key);
    b.total    += d.total    || 0;
    b.txnCount += d.txnCount || 0;
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      ...v,
      label: toDate(key + '-15').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
    }));
}

// ── Mini bar chart (pure SVG, no library) ──────────────────────────────────────
function BarChart({ data, color = '#FFA916' }) {
  if (!data?.length) return <div className="flex h-20 items-center justify-center text-xs text-gray-300">No data</div>;
  const max = Math.max(...data.map((d) => d.value ?? d.total ?? 0), 1);
  const W = 300;
  const H = 100;
  const labelH = 18;
  const chartH = H - labelH;
  const count = data.length;
  const gap = count > 20 ? 1 : count > 10 ? 2 : 4;
  const barW = Math.max(2, (W - gap * (count - 1)) / count);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
      {data.map((d, i) => {
        const val = d.value ?? d.total ?? 0;
        const bh = Math.max((val / max) * chartH, val > 0 ? 2 : 0);
        const x = i * (barW + gap);
        const y = chartH - bh;
        // Only show labels when there's room: skip if too many bars
        const showLabel = count <= 31 || i % Math.ceil(count / 12) === 0;
        return (
          <g key={d.date ?? i}>
            <rect x={x} y={y} width={barW} height={bh}
              fill={val > 0 ? color : '#E5E7EB'} rx="2" />
            {showLabel && (
              <text x={x + barW / 2} y={H - 2}
                textAnchor="middle" fontSize="8" fill="#9CA3AF"
                fontFamily="system-ui, sans-serif">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, Icon, gradient, iconColor, sub, accent }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 shadow-sm ${gradient}`}>
      <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
      <div className="absolute right-4 bottom-2 h-12 w-12 rounded-full bg-white/5" />
      <div className="relative flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-semibold uppercase tracking-widest ${accent}`}>{label}</p>
          <p className="mt-1.5 text-3xl font-extrabold leading-none text-white break-all">{value}</p>
          {sub && <p className={`mt-1.5 text-xs ${accent} flex items-center gap-1`}>{sub}</p>}
        </div>
        <div className="ml-3 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  completed: 'bg-green-100 text-green-700',
  void:      'bg-red-100 text-red-600',
  refund:    'bg-orange-100 text-orange-600',
  held:      'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

// ── Section card wrapper ───────────────────────────────────────────────────────
function Card({ title, icon: Icon, children, className = '', action }) {
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          {Icon && (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50">
              <Icon className="h-3.5 w-3.5 text-primary-600" />
            </div>
          )}
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Sales trend chart card ─────────────────────────────────────────────────────
const PERIOD_OPTIONS = [
  { label: '7d',  days: 6  },
  { label: '30d', days: 29 },
  { label: '90d', days: 89 },
];

function SalesTrendCard({ trend, trendDays, period, onPeriod }) {
  const grouped     = groupTrend(trend, trendDays ?? 6);
  const periodTotal = grouped.reduce((s, d) => s + (d.total || 0), 0);

  const periodToggle = (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
      {PERIOD_OPTIONS.map((p) => (
        <button key={p.label} onClick={() => onPeriod(p.label)}
          className={`px-2.5 py-1 font-medium transition-colors ${
            period === p.label ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'
          }`}>{p.label}</button>
      ))}
    </div>
  );

  return (
    <Card title="Revenue Trend" icon={TrendingUp} action={periodToggle}>
      <div className="mb-4">
        <p className="text-2xl font-extrabold text-gray-900">{formatCurrency(periodTotal)}</p>
        <p className="text-xs text-gray-400 mt-0.5">Total revenue for selected period</p>
      </div>
      <BarChart data={grouped} />
    </Card>
  );
}

// ── Branch comparison card (company admin+) ───────────────────────────────────
function BranchComparisonCard({ branches }) {
  if (!branches?.length) {
    return (
      <Card title="Branch Performance" icon={Building2}>
        <p className="text-sm text-gray-400">No branch data yet.</p>
      </Card>
    );
  }

  const maxMonth = Math.max(...branches.map((b) => b.monthSales), 1);

  return (
    <Card title="Branch Performance (This Month)" icon={Building2}>
      <div className="space-y-3">
        {branches.map((b, i) => (
          <div key={b.branchId}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700 truncate max-w-[120px]" title={b.branchName}>
                {i === 0 && <Star className="mr-1 inline h-3 w-3 text-secondary-500" />}
                {b.branchName}
              </span>
              <span className="text-gray-500">{formatCurrency(b.monthSales)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-secondary-500 transition-all duration-500"
                style={{ width: `${(b.monthSales / maxMonth) * 100}%` }}
              />
            </div>
            <p className="mt-0.5 text-right text-xs text-gray-400">
              Today: {formatCurrency(b.todaySales)}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Category breakdown card ────────────────────────────────────────────────────
const CATEGORY_COLORS = [
  '#024A59','#FFA916','#16a34a','#7c3aed','#0ea5e9','#f43f5e','#f97316','#64748b',
];

function CategoryBreakdownCard({ categories }) {
  if (!categories?.length) {
    return (
      <Card title="Sales by Category (30 days)" icon={Layers}>
        <p className="text-sm text-gray-400">No sales data yet.</p>
      </Card>
    );
  }
  const total = categories.reduce((s, c) => s + c.revenue, 0) || 1;

  return (
    <Card title="Sales by Category (30 days)" icon={Layers}>
      <div className="space-y-2.5">
        {categories.map((c, i) => {
          const pct = Math.round((c.revenue / total) * 100);
          const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          return (
            <div key={c.categoryName}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="font-medium text-gray-700 truncate max-w-[120px]" title={c.categoryName}>
                    {c.categoryName}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 text-gray-500">
                  <span>{pct}%</span>
                  <span className="font-semibold text-gray-700">{formatCurrency(c.revenue)}</span>
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Top products card ──────────────────────────────────────────────────────────
const RANK_STYLES = [
  'bg-amber-400 text-white',
  'bg-gray-300 text-gray-700',
  'bg-orange-300 text-white',
];

function TopProductsCard({ products }) {
  if (!products?.length) {
    return (
      <Card title="Top Products (30 days)" icon={Package}>
        <p className="text-sm text-gray-400">No sales data yet.</p>
      </Card>
    );
  }
  const maxRevenue = Math.max(...products.map((p) => p.revenue), 1);

  return (
    <Card title="Top Products (30 days)" icon={Package}>
      <div className="space-y-3">
        {products.map((p, i) => (
          <div key={p.sku} className="flex items-center gap-3">
            <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${RANK_STYLES[i] || 'bg-gray-100 text-gray-400'}`}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]" title={p.productName}>{p.productName}</span>
                <span className="text-xs font-semibold text-gray-900 ml-2 flex-shrink-0">{formatCurrency(p.revenue)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-primary-500 transition-all duration-700"
                  style={{ width: `${(p.revenue / maxRevenue) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Recent transactions table ──────────────────────────────────────────────────
function RecentTransactionsCard({ transactions }) {
  const viewAll = <a href="/app/sales" className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors">View all →</a>;

  if (!transactions?.length) {
    return (
      <Card title="Recent Transactions" icon={ShoppingCart} className="lg:col-span-2" action={viewAll}>
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <ShoppingCart className="h-8 w-8 text-gray-200" />
          <p className="text-sm text-gray-400">No transactions yet today.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Recent Transactions" icon={ShoppingCart} className="lg:col-span-2" action={viewAll}>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ref</th>
              <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Customer</th>
              <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 hidden md:table-cell">Cashier</th>
              <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 hidden lg:table-cell">Branch</th>
              <th className="pb-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">Amount</th>
              <th className="pb-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400 hidden sm:table-cell">Method</th>
              <th className="pb-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.transactionId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
                <td className="py-3 pr-4 font-mono text-xs font-medium text-primary-600">{t.transactionNumber}</td>
                <td className="py-3 pr-4 text-sm text-gray-800 truncate max-w-[110px]">{t.customerName}</td>
                <td className="py-3 pr-4 text-xs text-gray-500 hidden md:table-cell truncate max-w-[90px]">{t.cashierName}</td>
                <td className="py-3 pr-4 text-xs text-gray-500 hidden lg:table-cell truncate max-w-[100px]">{t.branchName}</td>
                <td className="py-3 pr-4 text-right text-sm font-bold text-gray-900">{formatCurrency(t.totalAmount)}</td>
                <td className="py-3 pr-4 text-center hidden sm:table-cell">
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{t.paymentMethod}</span>
                </td>
                <td className="py-3 text-center"><StatusBadge status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Low stock alert card ───────────────────────────────────────────────────────
function LowStockAlertCard({ count }) {
  return (
    <Card title="Stock Alerts" icon={AlertTriangle}>
      {count > 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </div>
          <p className="text-3xl font-bold text-red-600">{count}</p>
          <p className="text-sm text-gray-500">product{count !== 1 ? 's' : ''} below reorder level</p>
          <a
            href="/app/inventory"
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
          >
            View Inventory <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
            <Package className="h-7 w-7 text-green-500" />
          </div>
          <p className="text-sm font-medium text-green-600">All stock levels are healthy</p>
        </div>
      )}
    </Card>
  );
}

// ── Platform overview (super_admin dashboard) ─────────────────────────────────
function PlatformOverview() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => api.get('/platform/stats').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const total     = data?.total_companies     ?? 0;
  const active    = data?.active_companies    ?? 0;
  const trial     = data?.trial_companies     ?? 0;
  const suspended = data?.suspended_companies ?? 0;
  const other     = Math.max(0, total - active - trial - suspended);

  const activeW    = total ? Math.round((active    / total) * 100) : 0;
  const trialW     = total ? Math.round((trial     / total) * 100) : 0;
  const suspendedW = total ? Math.round((suspended / total) * 100) : 0;
  const otherW     = total ? Math.max(0, 100 - activeW - trialW - suspendedW) : 0;

  const QUICK_ACTIONS = [
    { label: 'Manage Companies',   icon: Building2,   to: '/app/admin?tab=companies',  color: 'text-primary-600',  bg: 'bg-primary-50',  border: 'border-primary-100',  hbg: 'hover:bg-primary-100'  },
    { label: 'Manage Users',       icon: Users,       to: '/app/admin?tab=users',      color: 'text-purple-600',   bg: 'bg-purple-50',   border: 'border-purple-100',   hbg: 'hover:bg-purple-100'   },
    { label: 'Subscription Plans', icon: CreditCard,  to: '/app/admin?tab=plans',      color: 'text-amber-600',    bg: 'bg-amber-50',    border: 'border-amber-100',    hbg: 'hover:bg-amber-100'    },
    { label: 'Sales Reports',      icon: BarChart3,   to: '/app/reports?tab=sales',    color: 'text-indigo-600',   bg: 'bg-indigo-50',   border: 'border-indigo-100',   hbg: 'hover:bg-indigo-100'   },
    { label: 'Finance Reports',    icon: TrendingUp,  to: '/app/reports?tab=pl',       color: 'text-green-600',    bg: 'bg-green-50',    border: 'border-green-100',    hbg: 'hover:bg-green-100'    },
    { label: 'Platform Settings',  icon: Settings,    to: '/app/admin?tab=pricing',    color: 'text-gray-600',     bg: 'bg-gray-50',     border: 'border-gray-200',     hbg: 'hover:bg-gray-100'     },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 bg-white p-5 animate-pulse">
              <div className="h-3 w-24 rounded bg-gray-100 mb-3" />
              <div className="h-8 w-16 rounded bg-gray-100 mb-2" />
              <div className="h-2.5 w-32 rounded bg-gray-100" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 animate-pulse flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-gray-100 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-16 rounded bg-gray-100" />
                <div className="h-5 w-10 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Primary metrics ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

        {/* Companies — hero card */}
        <div
          className="relative overflow-hidden rounded-2xl p-5 text-white lg:col-span-1 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #024A59 0%, #037080 100%)' }}
          onClick={() => navigate('/app/admin?tab=companies')}
        >
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/5" />
          <div className="absolute -right-2 bottom-2 h-16 w-16 rounded-full bg-white/5" />
          <div className="flex items-start justify-between relative">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/60">Total Companies</p>
              <p className="mt-1 text-4xl font-extrabold leading-none">{total}</p>
            </div>
            <div className="rounded-xl bg-white/10 p-2.5">
              <Globe className="h-5 w-5 text-white/80" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-400 inline-block" />{active} active</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-300 inline-block" />{trial} trial</span>
            {suspended > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400 inline-block" />{suspended} suspended</span>}
          </div>
        </div>

        {/* Today's Revenue */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-600/80">Today's Revenue</p>
              <p className="mt-1 text-3xl font-extrabold leading-none text-amber-800">
                {data?.today_sales != null ? formatCurrency(data.today_sales) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-amber-100 p-2.5">
              <DollarSign className="h-5 w-5 text-amber-600" />
            </div>
          </div>
          <p className="mt-3 text-xs text-amber-600/70">Gross revenue across all tenants today</p>
        </div>

        {/* Live Sessions */}
        <div className="relative overflow-hidden rounded-2xl border border-green-100 bg-gradient-to-br from-green-50 to-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-green-700/70">Live Sessions</p>
              <div className="mt-1 flex items-end gap-2">
                <p className="text-3xl font-extrabold leading-none text-green-800">{data?.open_sessions ?? '—'}</p>
                {(data?.open_sessions ?? 0) > 0 && (
                  <span className="mb-1 flex items-center gap-1 text-xs font-medium text-green-600">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                    </span>
                    live
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-green-100 p-2.5">
              <Activity className="h-5 w-5 text-green-600" />
            </div>
          </div>
          <p className="mt-3 text-xs text-green-700/60">Open POS sessions right now</p>
        </div>

        {/* Total Users */}
        <div className="relative overflow-hidden rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-purple-700/70">Platform Users</p>
              <p className="mt-1 text-3xl font-extrabold leading-none text-purple-800">{data?.total_users ?? '—'}</p>
            </div>
            <div className="rounded-xl bg-purple-100 p-2.5">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
          </div>
          <p className="mt-3 text-xs text-purple-700/60">Active users across all tenants</p>
        </div>
      </div>

      {/* ── Company health bar ── */}
      {total > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">Company Health</p>
            <p className="text-xs text-gray-400">{total} total companies</p>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
            {activeW    > 0 && <div className="bg-green-500 transition-all"  style={{ width: `${activeW}%` }} />}
            {trialW     > 0 && <div className="bg-amber-400 transition-all"  style={{ width: `${trialW}%` }} />}
            {suspendedW > 0 && <div className="bg-red-400 transition-all"    style={{ width: `${suspendedW}%` }} />}
            {otherW     > 0 && <div className="bg-gray-300 transition-all"   style={{ width: `${otherW}%` }} />}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-gray-600"><span className="h-2.5 w-2.5 rounded-sm bg-green-500 inline-block" /><strong>{active}</strong> Active</span>
            <span className="flex items-center gap-1.5 text-gray-600"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400 inline-block" /><strong>{trial}</strong> Trial</span>
            <span className="flex items-center gap-1.5 text-gray-600"><span className="h-2.5 w-2.5 rounded-sm bg-red-400 inline-block" /><strong>{suspended}</strong> Suspended</span>
            {other > 0 && <span className="flex items-center gap-1.5 text-gray-600"><span className="h-2.5 w-2.5 rounded-sm bg-gray-300 inline-block" /><strong>{other}</strong> Other</span>}
          </div>
        </div>
      )}

      {/* ── Secondary metrics ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Branches',   value: data?.total_branches  ?? '—', icon: GitBranch, iconBg: 'bg-indigo-100',  iconCl: 'text-indigo-600',  sub: 'active branches'     },
          { label: 'Products',   value: data?.total_products  ?? '—', icon: Package,   iconBg: 'bg-teal-100',    iconCl: 'text-teal-600',    sub: 'catalogue entries'   },
          { label: 'Customers',  value: data?.total_customers ?? '—', icon: UserCheck, iconBg: 'bg-orange-100',  iconCl: 'text-orange-600',  sub: 'registered customers'},
          { label: 'Suspended',  value: suspended,                     icon: AlertTriangle, iconBg: suspended > 0 ? 'bg-red-100' : 'bg-gray-100', iconCl: suspended > 0 ? 'text-red-500' : 'text-gray-400', sub: 'companies suspended' },
        ].map(({ label, value, icon: Icon, iconBg, iconCl, sub }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className={`flex-shrink-0 rounded-lg p-2 ${iconBg}`}>
              <Icon className={`h-4 w-4 ${iconCl}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
              <p className="text-xl font-bold text-gray-800 leading-tight">{value}</p>
              <p className="text-[11px] text-gray-400 truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Quick actions ── */}
      <div>
        <p className="mb-3 text-sm font-semibold text-gray-600">Quick Actions</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map(({ label, icon: Icon, to, color, bg, border, hbg }) => (
            <button
              key={label}
              onClick={() => navigate(to)}
              className={`flex flex-col items-center gap-2 rounded-xl border ${border} ${bg} ${hbg} px-3 py-4 text-center transition-all hover:shadow-sm`}
            >
              <div className={`rounded-lg p-2 bg-white shadow-sm`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <span className="text-xs font-medium text-gray-700 leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate();
  const activeCompanyId = useAuthStore((s) => s.activeCompanyId);
  const [trendPeriod, setTrendPeriod] = useState('7d');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', activeCompanyId ?? 'platform', trendPeriod],
    queryFn: () => api.get('/reports/dashboard', { params: { period: trendPeriod } }).then((r) => r.data.data),
    staleTime: 60_000,
    refetchInterval: 120_000,
    keepPreviousData: true,
  });

  const { hasCapability, user } = usePermission();
  const isSuperAdmin = user?.role === 'super_admin';
  const canViewSales = hasCapability('sales.view') || ['super_admin', 'company_admin', 'branch_manager', 'accountant'].includes(user?.role);
  const canViewInventory = hasCapability('inventory.view');
  const canViewCustomers = hasCapability('customers.view');
  const canCompareBranches = hasCapability('settings.manage') || hasCapability('platform.admin');

  if (isLoading && !isSuperAdmin) return <PageSpinner />;

  if (isError && !isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-red-400" />
        <p className="text-gray-500">Could not load dashboard. Check that the server is running.</p>
      </div>
    );
  }

  if (isSuperAdmin) {
    const today = new Date().toLocaleDateString('en-KE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-bold text-primary-700">
                <Layers className="h-3 w-3" /> Super Admin
              </span>
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900">Platform Dashboard</h1>
            <p className="mt-0.5 text-sm text-gray-400">{today}</p>
          </div>
          <button
            onClick={() => navigate('/app/admin')}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <Settings className="h-4 w-4 text-gray-500" />
            Admin Panel
          </button>
        </div>
        <PlatformOverview />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Stat strip ── */}
      {canViewSales && (
        <div className={`grid grid-cols-2 gap-4 ${
          canCompareBranches && data?.branchComparison?.length > 0
            ? 'lg:grid-cols-4'
            : canViewInventory ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}>
          <StatCard
            label="Today's Sales"
            value={formatCurrency(data?.todaySales ?? 0)}
            Icon={TrendingUp}
            gradient="bg-gradient-to-br from-primary-600 to-primary-800"
            iconColor="text-white"
            accent="text-primary-200"
            sub={`${data?.todayTransactions ?? 0} transactions today`}
          />
          <StatCard
            label="Transactions"
            value={data?.todayTransactions ?? 0}
            Icon={ShoppingCart}
            gradient="bg-gradient-to-br from-secondary-500 to-secondary-700"
            iconColor="text-white"
            accent="text-secondary-200"
            sub="completed today"
          />
          {canViewInventory && (
            <StatCard
              label="Low Stock"
              value={data?.lowStockCount ?? 0}
              Icon={Package}
              gradient={data?.lowStockCount > 0
                ? 'bg-gradient-to-br from-red-500 to-red-700'
                : 'bg-gradient-to-br from-emerald-500 to-emerald-700'}
              iconColor="text-white"
              accent={data?.lowStockCount > 0 ? 'text-red-200' : 'text-emerald-200'}
              sub={data?.lowStockCount > 0 ? 'items need restocking' : 'all stock healthy'}
            />
          )}
          {canCompareBranches && data?.branchComparison?.length > 0 && (
            <StatCard
              label="Active Branches"
              value={data.branchComparison.length}
              Icon={Building2}
              gradient="bg-gradient-to-br from-violet-500 to-violet-700"
              iconColor="text-white"
              accent="text-violet-200"
              sub={`${formatCurrency(data.branchComparison.reduce((s,b) => s + b.todaySales, 0))} total today`}
            />
          )}
        </div>
      )}

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {canViewSales && (
          <div className="lg:col-span-2">
            <SalesTrendCard
              trend={data?.salesTrend}
              trendDays={data?.trendDays ?? 6}
              period={trendPeriod}
              onPeriod={setTrendPeriod}
            />
          </div>
        )}
        <div className="lg:col-span-1">
          {canCompareBranches
            ? <BranchComparisonCard branches={data?.branchComparison} />
            : canViewSales
            ? <TopProductsCard products={data?.topProducts} />
            : canViewInventory && <LowStockAlertCard count={data?.lowStockCount ?? 0} />
          }
        </div>
      </div>

      {/* ── Bottom grid ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {canViewSales && (
          <div className="lg:col-span-2">
            <RecentTransactionsCard transactions={data?.recentTransactions} />
          </div>
        )}
        <div className="flex flex-col gap-5">
          {canViewSales && <CategoryBreakdownCard categories={data?.categoryBreakdown} />}
          {canCompareBranches
            ? <TopProductsCard products={data?.topProducts} />
            : canViewInventory && <LowStockAlertCard count={data?.lowStockCount ?? 0} />
          }
        </div>
      </div>

    </div>
  );
}
