const { Router } = require('express');
const Joi         = require('joi');
const { authenticate, attachTenant }     = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant,
        requireTenantContext }           = require('../../middleware/tenant.middleware');
const { requireRole }                   = require('../../middleware/rbac.middleware');
const { validate, validateQuery }       = require('../../shared/validators/common.validators');
const controller                        = require('./mpesa.controller');

const phone = Joi.string().max(15);

const stkPushSchema = Joi.object({
  phone:            phone.required(),
  amount:           Joi.number().positive().required(),
  accountReference: Joi.string().max(12).default('POS'),
  description:      Joi.string().max(13).default('POS Payment'),
  branchId:         Joi.string().uuid().allow(null, ''),
});

const manualSchema = Joi.object({
  receiptNumber:    Joi.string().alphanum().min(6).max(20).required(),
  amount:           Joi.number().positive().required(),
  phone:            phone.allow(null, ''),
  accountReference: Joi.string().max(12).allow(null, ''),
  description:      Joi.string().max(100).allow(null, ''),
});

const configSchema = Joi.object({
  branchId:      Joi.string().uuid().allow(null, ''),
  consumerKey:   Joi.string().min(1).required(),
  consumerSecret:Joi.string().min(1).required(),
  shortcode:     Joi.string().min(4).max(10).required(),
  shortcodeType: Joi.string().valid('paybill', 'till').default('paybill'),
  passkey:       Joi.string().min(1).required(),
  environment:   Joi.string().valid('sandbox', 'production').default('sandbox'),
  callbackUrl:   Joi.string().uri().allow(null, ''),
});

const linkSaleSchema = Joi.object({
  salesTransactionId: Joi.string().uuid().required(),
});

const listQuerySchema = Joi.object({
  status:      Joi.string().valid('pending', 'completed', 'failed', 'cancelled', 'timeout').allow(''),
  paymentMode: Joi.string().valid('stk_push', 'manual', 'c2b').allow(''),
  startDate:   Joi.string().isoDate().allow(''),
  endDate:     Joi.string().isoDate().allow(''),
  search:      Joi.string().max(100).allow(''),
  branchId:    Joi.string().uuid().allow(''),
  page:        Joi.number().integer().min(1).default(1),
  limit:       Joi.number().integer().min(1).max(100).default(25),
});

const unlinkedQuerySchema = Joi.object({
  amount: Joi.number().positive().allow(''),
  hours:  Joi.number().integer().min(1).max(720).default(48),
});

const router = Router();

// ── Public — Daraja sends callbacks here, no auth token ───────────────────────
// Must be registered before the authenticate middleware block below.
router.post('/callback',              controller.callback);
router.post('/callback/c2b',          controller.c2bConfirm);   // C2B confirmation
router.post('/callback/c2b/validate', controller.c2bValidate);  // C2B validation

// ── All other routes require authentication + tenant context ──────────────────
router.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

// Config — company_admin only
router.get('/config',         requireRole('company_admin'), controller.getConfig);
router.post('/config',        requireRole('company_admin'), validate(configSchema), controller.saveConfig);
router.post('/register-c2b',  requireRole('company_admin'), controller.registerC2B);

// Transaction list — accountant and above
router.get('/transactions', requireRole('accountant'), validateQuery(listQuerySchema), controller.list);

// Cashier operations
router.post('/stk-push',                     requireRole('cashier'), validate(stkPushSchema),        controller.stkPush);
router.get('/stk-status/:checkoutRequestId', requireRole('cashier'),                                 controller.stkStatus);
router.post('/manual',                       requireRole('cashier'), validate(manualSchema),          controller.manualEntry);
router.get('/unlinked',                      requireRole('cashier'), validateQuery(unlinkedQuerySchema), controller.unlinked);
router.patch('/:id/link-sale',               requireRole('cashier'), validate(linkSaleSchema),        controller.linkToSale);

module.exports = router;
