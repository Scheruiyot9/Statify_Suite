const { Router } = require('express');
const { authenticate, attachTenant }      = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }             = require('../../middleware/tenant.middleware');
const { requirePermission }               = require('../../middleware/rbac.middleware');
const ctrl                                = require('./returns.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

// Return reasons catalogue
router.get   ('/reasons',     requirePermission('process_refund'), ctrl.listReasons);
router.post  ('/reasons',     requirePermission('process_refund'), ctrl.createReason);
router.put   ('/reasons/:id', requirePermission('process_refund'), ctrl.updateReason);
router.delete('/reasons/:id', requirePermission('process_refund'), ctrl.deleteReason);

// Returns CRUD
router.get('/',    requirePermission('process_refund'), ctrl.list);
router.post('/',   requirePermission('process_refund'), ctrl.create);
router.get('/:id', requirePermission('process_refund'), ctrl.getOne);

// Approval workflow
router.patch('/:id/approve', requirePermission('process_refund'), ctrl.approve);
router.patch('/:id/reject',  requirePermission('process_refund'), ctrl.reject);
// Confirm refund was physically dispensed to customer
router.patch('/:id/refund',  requirePermission('process_refund'), ctrl.markRefunded);

module.exports = router;
