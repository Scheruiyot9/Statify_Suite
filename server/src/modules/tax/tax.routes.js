const { Router } = require('express');
const { authenticate, attachTenant }        = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }              = require('../../middleware/tenant.middleware');
const { requirePermission }                = require('../../middleware/rbac.middleware');
const controller                           = require('./tax.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

router.get('/',         controller.list);
router.get('/default',  controller.getDefault);
router.post('/',        requirePermission('manage_settings'), controller.create);
router.put('/:id',      requirePermission('manage_settings'), controller.update);
router.delete('/:id',   requirePermission('manage_settings'), controller.remove);

module.exports = router;
