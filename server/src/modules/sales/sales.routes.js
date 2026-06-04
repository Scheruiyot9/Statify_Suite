const { Router } = require('express');
const { authenticate, attachTenant }           = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }                  = require('../../middleware/tenant.middleware');
const { requireRole, requirePermission }       = require('../../middleware/rbac.middleware');
const controller                               = require('./sales.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

// ── Read — requires view_sales permission (sales_staff role lacks this) ───────
router.get('/transactions',     requirePermission('view_sales'), controller.list);
router.get('/transactions/:id', requirePermission('view_sales'), controller.getOne);

// ── Cashier+ creates a sale ───────────────────────────────────────────────────
router.post('/transactions',          requireRole('cashier'),         controller.create);

// ── Void requires branch_manager approval ────────────────────────────────────
router.post('/transactions/:id/void', requireRole('branch_manager'), controller.voidOne);

module.exports = router;
