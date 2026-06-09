import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Receipt, Warehouse, BarChart2,
  Monitor, RotateCcw, Users, Menu,
} from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/app/store';

export default function BottomNav({ onOpenMenu }) {
  const { hasCapability } = usePermission();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  // Not needed for super-admins or on the POS screen itself
  if (user?.role === 'super_admin') return null;
  if (location.pathname.startsWith('/pos')) return null;

  // Build ordered candidate list — role-appropriate shortcuts
  const candidates = [
    hasCapability('dashboard.view') && {
      to: '/app/dashboard', Icon: LayoutDashboard, label: 'Home',
    },
    hasCapability('pos.open') && {
      to: '/pos', Icon: Monitor, label: 'POS', external: true,
    },
    hasCapability('sales.view') && {
      to: '/app/sales', Icon: Receipt, label: 'Sales',
    },
    hasCapability('returns.view') && !hasCapability('inventory.view') && {
      to: '/app/returns', Icon: RotateCcw, label: 'Returns',
    },
    hasCapability('inventory.view') && {
      to: '/app/inventory', Icon: Warehouse, label: 'Stock',
    },
    hasCapability('reports.view') && {
      to: '/app/reports?tab=sales', Icon: BarChart2, label: 'Reports',
    },
    hasCapability('customers.view') && !hasCapability('inventory.view') && {
      to: '/app/customers', Icon: Users, label: 'Customers',
    },
  ].filter(Boolean).slice(0, 4); // max 4 before the Menu button

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-gray-200 bg-white lg:hidden shadow-[0_-1px_8px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {candidates.map(({ to, Icon, label, external }) => {
        if (external) {
          // POS link goes outside /app — use an anchor-style NavLink
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => [
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                isActive ? 'text-primary-600' : 'text-gray-500 active:text-gray-700',
              ].join(' ')}
            >
              {({ isActive }) => (
                <>
                  <div className={[
                    'flex h-7 w-7 items-center justify-center rounded-lg mb-0.5',
                    isActive ? 'bg-primary-500' : 'bg-secondary-500',
                  ].join(' ')}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <span className={isActive ? 'text-primary-600 font-semibold' : ''}>{label}</span>
                </>
              )}
            </NavLink>
          );
        }

        // Check if this is a tab-based link (has ?)
        const [toPath, toSearch] = to.split('?');
        const hasQuery = Boolean(toSearch);
        const isActiveQuery = hasQuery
          ? location.pathname === toPath && location.search === `?${toSearch}`
          : undefined;

        return (
          <NavLink
            key={to}
            to={to}
            end={hasQuery}
            className={hasQuery
              ? [
                  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                  isActiveQuery ? 'text-primary-600' : 'text-gray-500 active:text-gray-700',
                ].join(' ')
              : ({ isActive }) => [
                  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary-600' : 'text-gray-500 active:text-gray-700',
                ].join(' ')
            }
          >
            {hasQuery ? (
              <>
                <Icon className={`h-5 w-5 ${isActiveQuery ? 'text-primary-500' : 'text-gray-400'}`} />
                <span className={isActiveQuery ? 'font-semibold' : ''}>{label}</span>
              </>
            ) : (
              ({ isActive }) => (
                <>
                  <Icon className={`h-5 w-5 ${isActive ? 'text-primary-500' : 'text-gray-400'}`} />
                  <span className={isActive ? 'font-semibold' : ''}>{label}</span>
                </>
              )
            )}
          </NavLink>
        );
      })}

      {/* Menu — always last, opens the sidebar drawer */}
      <button
        onClick={onOpenMenu}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-gray-500 transition-colors active:text-gray-700"
      >
        <Menu className="h-5 w-5 text-gray-400" />
        More
      </button>
    </nav>
  );
}
