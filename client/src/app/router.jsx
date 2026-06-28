import { Navigate, Route, Routes } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuthStore } from './store';
import { capabilitiesForRole, permissionToCapability } from './permissions';

import LoginPage        from '@/features/auth/LoginPage';
import ResetPasswordPage from '@/features/auth/ResetPasswordPage';
import AppLayout        from '@/components/layout/AppLayout';
import PosLayout        from '@/components/layout/PosLayout';
import DashboardPage    from '@/features/dashboard/DashboardPage';
import ProductsPage     from '@/features/products/ProductsPage';
import InventoryPage    from '@/features/inventory/InventoryPage';
import CustomersPage        from '@/features/customers/CustomersPage';
import CustomerLedgerPage  from '@/features/customers/CustomerLedgerPage';
import SalesPage        from '@/features/sales/SalesPage';
import ReturnsPage      from '@/features/returns/ReturnsPage';
import ShiftsPage       from '@/features/shifts/ShiftsPage';
import ReportsPage      from '@/features/reports/ReportsPage';
import SettingsPage     from '@/features/settings/SettingsPage';
import AdminPage        from '@/features/admin/AdminPage';
import UsersPage        from '@/features/users/UsersPage';
import PosTerminal      from '@/features/pos/PosTerminal';
import MpesaPage        from '@/features/mpesa/MpesaPage';
import AccountsPage     from '@/features/accounts/AccountsPage';
import AccountLedgerPage from '@/features/accounts/AccountLedgerPage';
import BankAccountsPage from '@/features/bank-accounts/BankAccountsPage';
import BankLedgerPage   from '@/features/bank-accounts/BankLedgerPage';
import SuppliersPage       from '@/features/suppliers/SuppliersPage';
import SupplierLedgerPage  from '@/features/suppliers/SupplierLedgerPage';
import PurchasesPage   from '@/features/purchases/PurchasesPage';
import PaymentsPage    from '@/features/payments/PaymentsPage';
import JournalPage    from '@/features/journal/JournalPage';

// Redirect unauthenticated users to /login
const PrivateRoute = ({ children }) => {
  const token = useAuthStore((s) => s.accessToken);
  return token ? children : <Navigate to="/login" replace />;
};

// Redirect already-authenticated users away from login
const PublicRoute = ({ children }) => {
  const token = useAuthStore((s) => s.accessToken);
  return token ? <Navigate to="/app/dashboard" replace /> : children;
};

// Guard: Finance module — shows upgrade prompt if plan lacks has_finance
const FinanceRoute = ({ children }) => {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'super_admin' && !user?.planFeatures?.hasFinance) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 mb-4">
          <Lock className="h-7 w-7 text-amber-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Finance Module</h2>
        <p className="text-gray-500 mt-2 max-w-md text-sm">
          Upgrade to the Growth plan or higher to access suppliers, chart of accounts, bank accounts, and financial reports.
        </p>
      </div>
    );
  }
  return children;
};

const CapabilityRoute = ({ children, capability }) => {
  const user = useAuthStore((s) => s.user);
  const roleAllows = capabilitiesForRole(user?.role).has(capability);
  const permissionAllows = (user?.permissions ?? []).some(
    (permission) => permissionToCapability[permission] === capability
  );
  if (!roleAllows && !permissionAllows) return <Navigate to="/app/dashboard" replace />;
  return children;
};

export default function AppRouter() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"          element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* POS Terminal — full-screen, own layout */}
      <Route path="/pos" element={
        <PrivateRoute>
          <CapabilityRoute capability="pos.open">
            <PosLayout><PosTerminal /></PosLayout>
          </CapabilityRoute>
        </PrivateRoute>
      } />

      {/* Back-office app */}
      <Route path="/app" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"  element={<CapabilityRoute capability="dashboard.view"><DashboardPage /></CapabilityRoute>} />
        <Route path="products"   element={<CapabilityRoute capability="products.view"><ProductsPage /></CapabilityRoute>} />
        <Route path="inventory"  element={<CapabilityRoute capability="inventory.view"><InventoryPage /></CapabilityRoute>} />
        <Route path="customers"  element={<CapabilityRoute capability="customers.view"><CustomersPage /></CapabilityRoute>} />
        <Route path="customers/:customerId/ledger" element={<CapabilityRoute capability="customers.view"><CustomerLedgerPage /></CapabilityRoute>} />
        <Route path="sales"      element={<CapabilityRoute capability="sales.view"><SalesPage /></CapabilityRoute>} />
        <Route path="mpesa"      element={<CapabilityRoute capability="mpesa.view"><MpesaPage /></CapabilityRoute>} />
        <Route path="returns"    element={<CapabilityRoute capability="returns.view"><ReturnsPage /></CapabilityRoute>} />
        <Route path="shifts"     element={
          <CapabilityRoute capability="shifts.view">
            <ShiftsPage />
          </CapabilityRoute>
        } />
        <Route path="reports"    element={<CapabilityRoute capability="reports.view"><ReportsPage /></CapabilityRoute>} />
        <Route path="users"      element={
          <CapabilityRoute capability="users.view">
            <UsersPage />
          </CapabilityRoute>
        } />
        <Route path="settings"   element={<CapabilityRoute capability="settings.manage"><SettingsPage /></CapabilityRoute>} />
        <Route path="admin"      element={
          <CapabilityRoute capability="platform.admin">
            <AdminPage />
          </CapabilityRoute>
        } />

        {/* Finance module — gated by plan */}
        <Route path="accounts"     element={<FinanceRoute><AccountsPage /></FinanceRoute>} />
        <Route path="accounts/:accountId/ledger" element={<FinanceRoute><AccountLedgerPage /></FinanceRoute>} />
        <Route path="bank-accounts" element={<FinanceRoute><BankAccountsPage /></FinanceRoute>} />
        <Route path="bank-accounts/:bankAccountId/ledger" element={<FinanceRoute><BankLedgerPage /></FinanceRoute>} />
        <Route path="suppliers"                          element={<FinanceRoute><SuppliersPage /></FinanceRoute>} />
        <Route path="suppliers/:supplierId/ledger"    element={<FinanceRoute><SupplierLedgerPage /></FinanceRoute>} />
        <Route path="purchases"    element={<FinanceRoute><PurchasesPage /></FinanceRoute>} />
        <Route path="payments"     element={<FinanceRoute><PaymentsPage /></FinanceRoute>} />
        <Route path="journal"      element={<FinanceRoute><JournalPage /></FinanceRoute>} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
    </Routes>
  );
}
