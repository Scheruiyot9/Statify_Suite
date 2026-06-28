const { Router } = require('express');
const { authenticate, attachTenant }           = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }                  = require('../../middleware/tenant.middleware');
const { requireAnyPermission }                 = require('../../middleware/rbac.middleware');
const controller                               = require('./customers.controller');

const router = Router();
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

// ── Customer groups ───────────────────────────────────────────────────────────
router.get('/groups',      controller.listGroups);
router.post('/groups',     requireAnyPermission('manage_customers'), controller.createGroup);
router.put('/groups/:id',  requireAnyPermission('manage_customers'), controller.updateGroup);
router.get('/',       controller.list);
router.get('/:id',    controller.getOne);

// ── Cashier+ can create customers during a sale ───────────────────────────────
router.post('/', requireAnyPermission('create_transaction', 'manage_customers'), controller.create);

// ── Branch manager+ edits or removes customer records ────────────────────────
router.put('/:id',    requireAnyPermission('manage_customers'), controller.update);
router.delete('/:id', requireAnyPermission('manage_customers'), controller.remove);

// ── Credit account ────────────────────────────────────────────────────────────
router.get('/:id/credit-transactions', controller.creditTransactions);
router.get('/:id/ledger', controller.customerLedger);
router.post('/:id/credit-payment', requireAnyPermission('manage_customers', 'create_transaction'), controller.creditPayment);
router.post('/:id/recalculate-balance', requireAnyPermission('manage_customers'), controller.recalculateCreditBalance);

module.exports = router;
