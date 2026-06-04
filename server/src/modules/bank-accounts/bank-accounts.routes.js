const { Router } = require('express');
const { authenticate, attachTenant }        = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }              = require('../../middleware/tenant.middleware');
const { requireRole, requireFinance }       = require('../../middleware/rbac.middleware');
const ctrl                                  = require('./bank-accounts.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext, requireFinance);

router.get ('/',           requireRole('accountant'), ctrl.list);
router.post('/',           requireRole('accountant'), ctrl.create);
router.get ('/:id/ledger', requireRole('accountant'), ctrl.ledger);
router.get ('/:id',        requireRole('accountant'), ctrl.getOne);
router.patch('/:id',       requireRole('accountant'), ctrl.update);
router.delete('/:id',      requireRole('company_admin'), ctrl.remove);

module.exports = router;
