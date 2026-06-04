const { Router } = require('express');
const { authenticate, attachTenant }           = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }                  = require('../../middleware/tenant.middleware');
const { requireRole }                          = require('../../middleware/rbac.middleware');
const controller                               = require('./branches.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

// ── Read (all tenant users need to know which branches exist) ─────────────────
router.get('/', controller.list);

// ── Writes require company_admin ──────────────────────────────────────────────
router.post('/',      requireRole('company_admin'), controller.create);
router.put('/:id',    requireRole('company_admin'), controller.update);
router.delete('/:id', requireRole('company_admin'), controller.remove);

module.exports = router;
