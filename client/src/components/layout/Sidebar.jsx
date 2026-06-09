import { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Warehouse, Users, Receipt,
  BarChart2, Settings, ShieldCheck, Monitor, UserCog, Clock,
  RotateCcw, Menu, ChevronDown, ChevronUp, X,
  Smartphone, Building2, GitBranch, Layers, ShoppingCart,
  CreditCard, BookOpen, Landmark, Truck, Lock, Star, ScrollText, FileText, CalendarRange,
  Droplets, ArrowDownLeft, AlertTriangle, Scale,
} from 'lucide-react';
import { useAuthStore } from '@/app/store';
import { usePermission } from '@/hooks/usePermission';

const MIN_WIDTH = 64;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 224;   // w-56
const COLLAPSED_THRESHOLD = 72; // <= this → icon-only mode

// ── NavItem ───────────────────────────────────────────────────────────────────

const navBase = 'flex items-center rounded-lg text-sm font-medium transition-all duration-150';
const navActive = 'bg-secondary-500/[.14] text-white font-semibold border-l-2 border-secondary-400';
const navHover = 'text-white/70 hover:bg-secondary-500/[.09] hover:text-white border-l-2 border-transparent hover:border-secondary-400/30';
const navLocked = 'text-white/45 cursor-not-allowed border-l-2 border-transparent';

function NavItem({ to, label, Icon, collapsed, locked, isAdmin, search }) {
  const navigate = useNavigate();
  const location = useLocation();

  if (isAdmin) {
    const target = `/app/admin${search ? `?tab=${search}` : ''}`;
    const isActive = location.pathname === '/app/admin' &&
      (search ? location.search === `?tab=${search}` : !location.search);

    return (
      <button
        onClick={() => navigate(target)}
        title={collapsed ? label : undefined}
        className={[
          navBase,
          collapsed ? 'justify-center p-2 border-none' : 'gap-3 pl-2 pr-3 py-2',
          isActive ? navActive : navHover,
        ].join(' ')}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-secondary-400' : ''}`} />
        {!collapsed && <span className="flex-1 text-left">{label}</span>}
        {!collapsed && locked && <Lock className="h-3 w-3 text-secondary-400/70 flex-shrink-0" />}
      </button>
    );
  }

  // For links with a query string, match both pathname and search
  const [toPath, toSearch] = to.split('?');
  const hasQuery = Boolean(toSearch);
  const isActiveQuery = hasQuery
    ? location.pathname === toPath && location.search === `?${toSearch}`
    : undefined;

  return (
    <NavLink
      to={to}
      end={hasQuery}
      title={collapsed ? label : undefined}
      className={hasQuery
        ? [navBase, collapsed ? 'justify-center p-2 border-none' : 'gap-3 pl-2 pr-3 py-2', isActiveQuery ? navActive : locked ? navLocked : navHover].join(' ')
        : ({ isActive }) => [navBase, collapsed ? 'justify-center p-2 border-none' : 'gap-3 pl-2 pr-3 py-2', isActive ? navActive : locked ? navLocked : navHover].join(' ')}
      onClick={locked ? (e) => e.preventDefault() : undefined}
    >
      {hasQuery
        ? (<>
            <Icon className={`h-4 w-4 flex-shrink-0 ${isActiveQuery ? 'text-secondary-400' : ''}`} />
            {!collapsed && <span className="flex-1">{label}</span>}
            {!collapsed && locked && <Lock className="h-3 w-3 text-secondary-400/70 flex-shrink-0" />}
          </>)
        : (({ isActive }) => (
            <>
              <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-secondary-400' : ''}`} />
              {!collapsed && <span className="flex-1">{label}</span>}
              {!collapsed && locked && <Lock className="h-3 w-3 text-secondary-400/70 flex-shrink-0" />}
            </>
          ))
      }
    </NavLink>
  );
}

// ── NavGroup ──────────────────────────────────────────────────────────────────

function NavGroup({ id, label, collapsed, defaultOpen = true, children }) {
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(`sidebar-group-${id}`);
    return stored !== null ? stored === 'true' : defaultOpen;
  });

  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem(`sidebar-group-${id}`, String(!v));
      return !v;
    });
  };

  if (collapsed) {
    return <div className="space-y-1 pt-1">{children}</div>;
  }

  return (
    <div className="space-y-1">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-secondary-200 hover:text-secondary-100 transition-colors"
      >
        <span>{label}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

// ── Finance Group ─────────────────────────────────────────────────────────────

function FinanceGroup({ collapsed, hasCapability }) {
  const user = useAuthStore((s) => s.user);
  const hasFinance = user?.planFeatures?.hasFinance ?? false;

  if (!hasCapability('settings.manage') || !hasFinance) return null;

  return (
    <NavGroup id="finance" label="Finance" collapsed={collapsed} defaultOpen={false}>
      <NavItem to="/app/suppliers"    label="Suppliers"     Icon={Truck}        collapsed={collapsed} />
      <NavItem to="/app/purchases"    label="Purchases"     Icon={ShoppingCart} collapsed={collapsed} />
      <NavItem to="/app/payments"     label="Payments"      Icon={CreditCard}   collapsed={collapsed} />
      <NavItem to="/app/accounts"     label="Accounts"      Icon={BookOpen}     collapsed={collapsed} />
      <NavItem to="/app/bank-accounts" label="Bank Accounts" Icon={Landmark}   collapsed={collapsed} />
      <NavItem to="/app/journal"      label="Journal"       Icon={ScrollText}   collapsed={collapsed} />
    </NavGroup>
  );
}

// ── Super Admin Nav ───────────────────────────────────────────────────────────

function SuperAdminNav({ collapsed }) {
  return (
    <nav className={['flex-1 overflow-y-auto py-3 space-y-3', collapsed ? 'px-2' : 'px-3'].join(' ')}>

      <NavItem to="/app/dashboard" label="Overview" Icon={LayoutDashboard} collapsed={collapsed} />

      <NavGroup id="sa-platform" label="Platform" collapsed={collapsed} defaultOpen>
        <NavItem to="/app/admin" label="Companies"      Icon={Building2}    collapsed={collapsed} isAdmin search="companies" />
        <NavItem to="/app/admin" label="Plans & Pricing" Icon={Star}        collapsed={collapsed} isAdmin search="plans" />
        <NavItem to="/app/admin" label="Subscriptions"  Icon={CalendarRange} collapsed={collapsed} isAdmin search="subscriptions" />
      </NavGroup>

      <NavGroup id="sa-people" label="People" collapsed={collapsed} defaultOpen>
        <NavItem to="/app/admin" label="All Users" Icon={UserCog} collapsed={collapsed} isAdmin search="users" />
        <NavItem to="/app/admin" label="Branches" Icon={GitBranch} collapsed={collapsed} isAdmin search="branches" />
      </NavGroup>

      <NavGroup id="sa-pos" label="POS Activity" collapsed={collapsed} defaultOpen={false}>
        <NavItem to="/app/admin" label="Sessions" Icon={Layers} collapsed={collapsed} isAdmin search="sessions" />
        <NavItem to="/app/admin" label="Terminals" Icon={Monitor} collapsed={collapsed} isAdmin search="terminals" />
        <NavItem to="/app/admin" label="Sales" Icon={Receipt} collapsed={collapsed} isAdmin search="sales" />
        <NavItem to="/app/admin" label="M-Pesa" Icon={Smartphone} collapsed={collapsed} isAdmin search="mpesa" />
        <NavItem to="/app/admin" label="M-Pesa Config" Icon={Settings} collapsed={collapsed} isAdmin search="mpesa-config" />
        <NavItem to="/app/admin" label="Payment Methods" Icon={CreditCard} collapsed={collapsed} isAdmin search="payments" />
      </NavGroup>

      <NavGroup id="sa-catalog" label="Catalog" collapsed={collapsed} defaultOpen={false}>
        <NavItem to="/app/admin" label="Products" Icon={Package} collapsed={collapsed} isAdmin search="products" />
        <NavItem to="/app/admin" label="Inventory" Icon={Warehouse} collapsed={collapsed} isAdmin search="inventory" />
        <NavItem to="/app/admin" label="Pricing Rules" Icon={CreditCard} collapsed={collapsed} isAdmin search="pricing" />
      </NavGroup>

      <NavGroup id="sa-crm" label="CRM" collapsed={collapsed} defaultOpen={false}>
        <NavItem to="/app/admin" label="Customers" Icon={Users} collapsed={collapsed} isAdmin search="customers" />
      </NavGroup>

      <NavGroup id="sa-reports" label="Reports" collapsed={collapsed} defaultOpen={false}>
        <NavItem to="/app/reports?tab=sales" label="Sales"       Icon={BarChart2}  collapsed={collapsed} />
        <NavItem to="/app/reports?tab=stock" label="Stock Value" Icon={Package}    collapsed={collapsed} />
      </NavGroup>

      <NavGroup id="sa-finance" label="Finance" collapsed={collapsed} defaultOpen={false}>
        <NavItem to="/app/admin" label="Suppliers"     Icon={Truck}       collapsed={collapsed} isAdmin search="suppliers" />
        <NavItem to="/app/admin" label="Purchases"     Icon={ShoppingCart} collapsed={collapsed} isAdmin search="purchases" />
        <NavItem to="/app/admin" label="AP Payments"   Icon={CreditCard}  collapsed={collapsed} isAdmin search="ap-payments" />
        <NavItem to="/app/admin" label="Accounts"      Icon={BookOpen}    collapsed={collapsed} isAdmin search="accounts" />
        <NavItem to="/app/admin" label="Bank Accounts" Icon={Landmark}    collapsed={collapsed} isAdmin search="bank-accounts" />
        <NavItem to="/app/admin" label="Journals"      Icon={ScrollText}  collapsed={collapsed} isAdmin search="journals" />
      </NavGroup>

      <NavGroup id="sa-finance-reports" label="Finance Reports" collapsed={collapsed} defaultOpen={false}>
        <NavItem to="/app/reports?tab=pl"            label="P&L"           Icon={FileText}      collapsed={collapsed} />
        <NavItem to="/app/reports?tab=cash-flow"     label="Cash Flow"     Icon={Droplets}      collapsed={collapsed} />
        <NavItem to="/app/reports?tab=ar-aging"      label="AR Aging"      Icon={ArrowDownLeft} collapsed={collapsed} />
        <NavItem to="/app/reports?tab=ap-aging"      label="AP Aging"      Icon={AlertTriangle} collapsed={collapsed} />
        <NavItem to="/app/reports?tab=balance-sheet" label="Balance Sheet" Icon={Scale}         collapsed={collapsed} />
      </NavGroup>

    </nav>
  );
}

// ── Tenant Nav ────────────────────────────────────────────────────────────────

function TenantNav({ collapsed, hasCapability }) {
  const user = useAuthStore((s) => s.user);
  const hasFinance  = (user?.planFeatures?.hasFinance ?? false) && user?.role !== 'branch_manager';
  const hasApiAccess = user?.planFeatures?.hasApiAccess ?? false;

  return (
    <nav className={['flex-1 overflow-y-auto py-3 space-y-3', collapsed ? 'px-2' : 'px-3'].join(' ')}>

      {hasCapability('dashboard.view') && (
        <NavItem to="/app/dashboard" label="Dashboard" Icon={LayoutDashboard} collapsed={collapsed} />
      )}

      {(hasCapability('sales.view') || hasCapability('returns.view') || hasCapability('shifts.view') || (hasCapability('mpesa.view') && hasApiAccess) || hasCapability('customers.view')) && (
        <NavGroup id="sales" label="Sales" collapsed={collapsed} defaultOpen>
          {hasCapability('sales.view') && <NavItem to="/app/sales" label="POS Sales" Icon={Receipt} collapsed={collapsed} />}
          {hasCapability('returns.view') && <NavItem to="/app/returns" label="Returns" Icon={RotateCcw} collapsed={collapsed} />}
          {hasCapability('shifts.view') && <NavItem to="/app/shifts" label="Shifts" Icon={Clock} collapsed={collapsed} />}
          {hasCapability('mpesa.view') && hasApiAccess && <NavItem to="/app/mpesa" label="M-Pesa" Icon={Smartphone} collapsed={collapsed} />}
          {hasCapability('customers.view') && <NavItem to="/app/customers" label="Customers" Icon={Users} collapsed={collapsed} />}
        </NavGroup>
      )}

      {(hasCapability('products.view') || hasCapability('inventory.view')) && (
        <NavGroup id="inventory" label="Inventory" collapsed={collapsed} defaultOpen>
          {hasCapability('products.view') && <NavItem to="/app/products" label="Products" Icon={Package} collapsed={collapsed} />}
          {hasCapability('inventory.view') && <NavItem to="/app/inventory" label="Inventory" Icon={Warehouse} collapsed={collapsed} />}
        </NavGroup>
      )}

      {hasCapability('reports.view') && (
        <NavGroup id="reports" label="Reports" collapsed={collapsed} defaultOpen={false}>
          <NavItem to="/app/reports?tab=sales" label="Sales"       Icon={BarChart2}  collapsed={collapsed} />
          <NavItem to="/app/reports?tab=stock" label="Stock Value" Icon={Package}    collapsed={collapsed} />
        </NavGroup>
      )}

      <FinanceGroup collapsed={collapsed} hasCapability={hasCapability} />

      {hasCapability('reports.view') && hasFinance && (
        <NavGroup id="finance-reports" label="Finance Reports" collapsed={collapsed} defaultOpen={false}>
          <NavItem to="/app/reports?tab=pl"            label="P&L"           Icon={FileText}      collapsed={collapsed} />
          <NavItem to="/app/reports?tab=cash-flow"     label="Cash Flow"     Icon={Droplets}      collapsed={collapsed} />
          <NavItem to="/app/reports?tab=ar-aging"      label="AR Aging"      Icon={ArrowDownLeft} collapsed={collapsed} />
          <NavItem to="/app/reports?tab=ap-aging"      label="AP Aging"      Icon={AlertTriangle} collapsed={collapsed} />
          <NavItem to="/app/reports?tab=balance-sheet" label="Balance Sheet" Icon={Scale}         collapsed={collapsed} />
        </NavGroup>
      )}

      {(hasCapability('users.view') || hasCapability('settings.manage')) && (
        <NavGroup id="admin" label="Administration" collapsed={collapsed} defaultOpen={false}>
          {hasCapability('users.view') && <NavItem to="/app/users" label="Users & Roles" Icon={UserCog} collapsed={collapsed} />}
          {hasCapability('settings.manage') && <NavItem to="/app/settings" label="Settings" Icon={Settings} collapsed={collapsed} />}
        </NavGroup>
      )}

    </nav>
  );
}

// ── Root Sidebar ──────────────────────────────────────────────────────────────

export default function Sidebar({ onMobileClose }) {
  const { hasCapability } = usePermission();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'super_admin';
  const location = useLocation();

  // Close mobile drawer when navigating
  useEffect(() => {
    onMobileClose?.();
  }, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem('sidebar-width');
    return stored ? Number(stored) : DEFAULT_WIDTH;
  });

  const sidebarRef = useRef(null);
  const dragging = useRef(false);

  const collapsed = width <= COLLAPSED_THRESHOLD;

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current || !sidebarRef.current) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX - rect.left));
      setWidth(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Snap to icon-only if user dragged close to minimum
      setWidth((w) => {
        const snapped = w < MIN_WIDTH + 20 ? MIN_WIDTH : w;
        localStorage.setItem('sidebar-width', String(snapped));
        return snapped;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startDrag = (e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const toggle = () => {
    setWidth((w) => {
      const next = w <= COLLAPSED_THRESHOLD ? DEFAULT_WIDTH : MIN_WIDTH;
      localStorage.setItem('sidebar-width', String(next));
      return next;
    });
  };

  return (
    <aside
      ref={sidebarRef}
      style={{ width, background: 'linear-gradient(180deg, #011920 0%, #012b38 28%, #024A59 62%, #012e3a 100%)' }}
      className="relative flex h-full flex-col text-white flex-shrink-0 border-r border-secondary-400/15"
    >
      {/* Logo + collapse toggle */}
      <div className={[
        'flex items-center border-b border-secondary-400/20 flex-shrink-0',
        collapsed ? 'flex-col gap-2 px-0 py-3 justify-center' : 'justify-between px-4 py-3',
      ].join(' ')}>
        {/* Mobile: close drawer button */}
        <button
          onClick={onMobileClose}
          className="flex lg:hidden flex-shrink-0 items-center justify-center rounded-lg p-1.5 text-white/70 hover:bg-white/15 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        {/* Desktop: collapse to icon-only toggle */}
        <button
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden lg:flex flex-shrink-0 items-center justify-center rounded-lg p-1.5 text-white/70 hover:bg-white/15 hover:text-white transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className={['flex items-center gap-2 overflow-hidden', collapsed ? '' : 'order-first'].join(' ')}>
          {collapsed ? (
            <img src="/statify-icon-white.svg" alt="Statify" className="h-8 w-8 flex-shrink-0" />
          ) : (
            <img src="/statify-logo-white.svg" alt="Statify Solutions Limited" className="h-16 w-auto flex-shrink-0" />
          )}
          {!collapsed && isSuperAdmin && (
            <span className="ml-1 text-xs text-secondary-400 font-medium whitespace-nowrap">Super Admin</span>
          )}
        </div>
      </div>

      {/* POS shortcut — tenant only */}
      {!isSuperAdmin && hasCapability('pos.open') && (
        <div className={['pt-3 flex-shrink-0', collapsed ? 'px-2' : 'px-3'].join(' ')}>
          <NavLink
            to="/pos"
            title="Open POS Terminal"
            className={[
              'flex items-center rounded-lg bg-secondary-500 text-sm font-semibold text-black hover:bg-secondary-600 transition-colors',
              collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2',
            ].join(' ')}
          >
            <Monitor className="h-4 w-4 flex-shrink-0" />
            {!collapsed && 'Open POS Terminal'}
          </NavLink>
        </div>
      )}

      {/* Navigation */}
      {isSuperAdmin
        ? <SuperAdminNav collapsed={collapsed} />
        : <TenantNav collapsed={collapsed} hasCapability={hasCapability} />
      }

      {/* Drag handle */}
      <div
        onMouseDown={startDrag}
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-secondary-500/40 active:bg-secondary-500/60 transition-colors z-10"
      />
    </aside>
  );
}
