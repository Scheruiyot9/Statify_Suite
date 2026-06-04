const { Router } = require('express');
const { authenticate, attachTenant }           = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }                  = require('../../middleware/tenant.middleware');
const { requirePermission, requireFinance }    = require('../../middleware/rbac.middleware');
const controller                               = require('./reports.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant);

// Dashboard — accessible to all authenticated users
router.get('/dashboard', controller.dashboard);

// Sales reports — tenant context + view_reports permission
router.get('/sales',           requireTenantContext, requirePermission('view_reports'), controller.salesReport);
router.get('/stock-valuation', requireTenantContext, requirePermission('view_reports'), controller.stockValuation);

// Finance reports — tenant context + Finance plan + view_reports
router.get('/pl',              requireTenantContext, requireFinance, requirePermission('view_reports'), controller.plReport);
router.get('/ap-aging',        requireTenantContext, requireFinance, requirePermission('view_reports'), controller.apAging);
router.get('/balance-sheet',   requireTenantContext, requireFinance, requirePermission('view_reports'), controller.balanceSheet);
router.get('/purchases-summary', requireTenantContext, requireFinance, requirePermission('view_reports'), controller.purchasesSummary);
router.get('/lpo',             requireTenantContext, requireFinance, requirePermission('view_reports'), controller.lpoReport);
router.get('/grn',             requireTenantContext, requireFinance, requirePermission('view_reports'), controller.grnReport);
router.get('/trial-balance',   requireTenantContext, requireFinance, requirePermission('view_reports'), controller.trialBalance);
router.get('/ledger',          requireTenantContext, requireFinance, requirePermission('view_reports'), controller.ledgerEntries);
router.get('/cash-flow',       requireTenantContext, requireFinance, requirePermission('view_reports'), controller.cashFlow);

module.exports = router;
