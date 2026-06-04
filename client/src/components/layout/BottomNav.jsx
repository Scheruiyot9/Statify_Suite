import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Receipt, Package, Users, Menu } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/app/store';

export default function BottomNav({ onOpenMenu }) {
  const { hasCapability } = usePermission();
  const user = useAuthStore((s) => s.user);

  // Bottom nav is only for tenant users — super admins use the sidebar
  if (user?.role === 'super_admin') return null;

  const navItems = [
    hasCapability('dashboard.view') && { to: '/app/dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
    hasCapability('sales.view')     && { to: '/app/sales',     Icon: Receipt,          label: 'POS Sales' },
    hasCapability('products.view')  && { to: '/app/products',  Icon: Package,          label: 'Products'  },
    hasCapability('customers.view') && { to: '/app/customers', Icon: Users,            label: 'Customers' },
  ].filter(Boolean).slice(0, 4);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-gray-200 bg-white lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {navItems.map(({ to, Icon, label }) => (
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
              <Icon className={`h-5 w-5 ${isActive ? 'text-primary-500' : 'text-gray-400'}`} />
              {label}
            </>
          )}
        </NavLink>
      ))}

      {/* Menu button — opens the sidebar drawer */}
      <button
        onClick={onOpenMenu}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-gray-500 transition-colors active:text-gray-700"
      >
        <Menu className="h-5 w-5 text-gray-400" />
        Menu
      </button>
    </nav>
  );
}
