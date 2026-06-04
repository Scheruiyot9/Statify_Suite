const { Router }      = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireRole }  = require('../../middleware/rbac.middleware');
const ctrl             = require('./platform.controller');

const router = Router();

// All platform routes: authenticated super_admin only — no tenant context needed
router.use(authenticate, requireRole('super_admin'));

// ── Overview ──────────────────────────────────────────────────────────────────
router.get('/stats',           ctrl.stats);

// ── Subscription Plans ────────────────────────────────────────────────────────
router.get('/plans',           ctrl.listPlans);
router.post('/plans',          ctrl.createPlan);
router.patch('/plans/:id',     ctrl.updatePlan);
router.delete('/plans/:id',    ctrl.deletePlan);

// ── Companies ────────────────────────────────────────────────────────────────
router.get('/companies',                    ctrl.companies);
router.patch('/companies/:id/plan',         ctrl.changeCompanyPlan);
router.patch('/companies/:id/status',       ctrl.changeCompanyStatus);

// ── People ───────────────────────────────────────────────────────────────────
router.get('/users',                  ctrl.users);
router.post('/users/super-admin',     ctrl.createSuperAdminUser);
router.put('/users/:id',              ctrl.updateAnyUser);
router.get('/branches',               ctrl.branches);

// ── POS Activity ─────────────────────────────────────────────────────────────
router.get('/terminals',       ctrl.terminals);
router.get('/sessions',        ctrl.sessions);
router.get('/sales',           ctrl.sales);
router.get('/mpesa',                      ctrl.mpesa);
router.get('/mpesa-configs',              ctrl.mpesaConfigs);
router.post('/mpesa-configs',             ctrl.saveMpesaConfig);
router.patch('/mpesa-configs/:id/toggle', ctrl.toggleMpesaConfig);

// ── Catalog ───────────────────────────────────────────────────────────────────
router.get('/products',        ctrl.products);
router.get('/inventory',       ctrl.inventory);

// ── CRM ──────────────────────────────────────────────────────────────────────
router.get('/customers',       ctrl.customers);
router.get('/payment-methods', ctrl.paymentMethods);

// ── Finance ───────────────────────────────────────────────────────────────────
router.get('/suppliers',       ctrl.suppliers);
router.get('/purchases',       ctrl.purchases);
router.get('/ap-payments',     ctrl.apPayments);
router.get('/accounts',        ctrl.accounts);
router.get('/bank-accounts',   ctrl.bankAccounts);
router.get('/journals',        ctrl.journals);

// ── Platform Stock Valuation (all companies or ?companyId filter) ────────────
router.get('/stock-valuation', ctrl.platformStockValuation);

// ── Finance Reports (platform-wide, optional ?companyId filter) ───────────────
router.get('/reports/sales',         ctrl.platformSalesReport);
router.get('/reports/pl',            ctrl.platformPLReport);
router.get('/reports/cash-flow',     ctrl.platformCashFlow);
router.get('/reports/ap-aging',      ctrl.platformAPAging);
router.get('/reports/balance-sheet', ctrl.platformBalanceSheet);
router.get('/reports/ar-aging',      ctrl.platformARAgingReport);

// ── Subscriptions ─────────────────────────────────────────────────────────────
router.get('/subscriptions',                        ctrl.listSubscriptions);
router.post('/subscriptions',                       ctrl.recordSubscription);
router.get('/subscription-requests',                ctrl.listSubscriptionRequests);
router.patch('/subscription-requests/:id',          ctrl.actionSubscriptionRequest);

module.exports = router;
