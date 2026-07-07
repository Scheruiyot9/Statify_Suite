// System journal functions: opening balances, AR settlement, reconciliation.
// Manual journal documents are handled by /journals (modules/journals/journals.routes.js).
const express = require('express');
const ctrl    = require('./journal.controller');
const { authenticate, attachTenant }                      = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant, requireTenantContext } = require('../../middleware/tenant.middleware');
const { requireRole, requireFinance }                     = require('../../middleware/rbac.middleware');

const r = express.Router();
r.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

r.get('/ar-aging',          requireFinance, requireRole('company_admin','accountant','branch_manager'), ctrl.arAging);
r.get('/unreconciled',      requireFinance, requireRole('company_admin','accountant'),                  ctrl.unreconciledLines);
r.post('/opening-balances', requireFinance, requireRole('company_admin','accountant'),                  ctrl.openingBalances);
r.post('/ar-settlement',    requireFinance, requireRole('company_admin','accountant'),                  ctrl.arSettlement);
r.post('/reconcile',        requireFinance, requireRole('company_admin','accountant'),                  ctrl.reconcile);
r.post('/daily-summaries',  requireFinance, requireRole('company_admin'),                               ctrl.postDailySummary);
r.get('/entries',           requireFinance, requireRole('company_admin','accountant','branch_manager'), ctrl.listEntries);
r.get('/entries/:id',       requireFinance, requireRole('company_admin','accountant','branch_manager'), ctrl.getEntry);
r.post('/entries/:id/void', requireFinance, requireRole('company_admin','accountant'),                  ctrl.voidEntry);

module.exports = r;
