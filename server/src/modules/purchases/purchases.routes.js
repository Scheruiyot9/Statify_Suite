const { Router } = require('express');
const { authenticate, attachTenant }   = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }         = require('../../middleware/tenant.middleware');
const { requireRole, requireFinance }  = require('../../middleware/rbac.middleware');
const ctrl                             = require('./purchases.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext, requireFinance);

// Purchase Orders
router.get ('/',                 requireRole('accountant'),    ctrl.listPOs);
router.post('/',                 requireRole('accountant'),    ctrl.createPO);
router.get ('/:id',              requireRole('accountant'),    ctrl.getPO);
router.patch('/:id',             requireRole('accountant'),    ctrl.updatePO);
router.post('/:id/submit',       requireRole('accountant'),    ctrl.submitPO);
router.post('/:id/approve',      requireRole('company_admin'), ctrl.approvePO);
router.post('/:id/cancel',       requireRole('company_admin'), ctrl.cancelPO);

// Goods Received Notes — nested under /purchases but accessed via /grns prefix in app.js
module.exports = router;
