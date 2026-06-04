const { Router } = require('express');
const { authenticate, attachTenant }           = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }                  = require('../../middleware/tenant.middleware');
const { requirePermission, requireRole }       = require('../../middleware/rbac.middleware');
const controller                               = require('./pos.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

// ── POS Product Catalog ───────────────────────────────────────────────────────
router.get('/products',                  requirePermission('open_pos_session'), controller.products);

// ── Payment methods ───────────────────────────────────────────────────────────
router.get('/payment-methods',           controller.paymentMethods);
router.post('/payment-methods',          requireRole('company_admin'), controller.createPaymentMethod);
router.patch('/payment-methods/:id',     requireRole('company_admin'), controller.updatePaymentMethod);

// ── Terminals ─────────────────────────────────────────────────────────────────
router.get('/terminals',                 requirePermission('open_pos_session'), controller.terminals);
router.get('/terminals/all',             requireRole('branch_manager'), controller.allTerminals);
router.post('/terminals',                requireRole('company_admin'),  controller.createTerminal);
router.patch('/terminals/:id',           requireRole('branch_manager'), controller.updateTerminal);
router.delete('/terminals/:id',          requireRole('company_admin'),  controller.deleteTerminal);

// ── Sessions — cashier level (own session) ────────────────────────────────────
router.get('/sessions/active',           requirePermission('open_pos_session'), controller.activeSession);
router.post('/sessions',                 requirePermission('open_pos_session'), controller.openSession);
router.get('/sessions/:id/summary',      requireRole('cashier'),        controller.sessionSummary);
router.patch('/sessions/:id/close',      requireRole('cashier'),        controller.closeSession);

// ── Sessions — branch manager level ──────────────────────────────────────────
router.get('/sessions',                  requireRole('branch_manager'), controller.listSessions);
router.get('/sessions/:id/detail',       requireRole('branch_manager'), controller.sessionDetail);
router.patch('/sessions/:id/force-close',requireRole('branch_manager'), controller.forceCloseSession);

module.exports = router;
