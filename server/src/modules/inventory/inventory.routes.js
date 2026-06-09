const { Router } = require('express');
const { authenticate, attachTenant }           = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }                  = require('../../middleware/tenant.middleware');
const { requirePermission, requireBranchAccess } = require('../../middleware/rbac.middleware');
const controller                               = require('./inventory.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

// ── Read — requires view_inventory (sales_staff role lacks this) ──────────────
router.get('/', requirePermission('view_inventory'), controller.list);

// ── Writes require adjust_stock permission + branch membership ────────────────
router.post('/adjust',
  requirePermission('adjust_stock'),
  requireBranchAccess('branch_id'),
  controller.adjust
);
router.post('/adjust-bulk',
  requirePermission('adjust_stock'),
  controller.adjustBulk
);
router.put('/:productId/branches/:branchId/reorder',
  requirePermission('adjust_stock'),
  requireBranchAccess('branchId'),
  controller.setReorder
);

module.exports = router;
