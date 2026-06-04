const { Router } = require('express');
const { authenticate, attachTenant }   = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }         = require('../../middleware/tenant.middleware');
const { requireRole, requireFinance }  = require('../../middleware/rbac.middleware');
const ctrl                             = require('./purchases.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext, requireFinance);

router.get ('/',           requireRole('accountant'),    ctrl.listGRNs);
router.post('/',           requireRole('accountant'),    ctrl.createGRN);
router.get ('/:id',        requireRole('accountant'),    ctrl.getGRN);
router.post('/:id/post',   requireRole('company_admin'), ctrl.postGRN);

module.exports = router;
