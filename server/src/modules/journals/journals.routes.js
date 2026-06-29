const express = require('express');
const ctrl    = require('./journals.controller');
const { authenticate, attachTenant }                      = require('../../middleware/auth.middleware');
const { verifyTenant, scopeTenant, requireTenantContext } = require('../../middleware/tenant.middleware');
const { requireRole, requireFinance }                     = require('../../middleware/rbac.middleware');

const r = express.Router();
r.use(authenticate, attachTenant, verifyTenant, scopeTenant, requireTenantContext);

const viewer = requireRole('company_admin', 'accountant', 'branch_manager');
const editor = requireRole('company_admin', 'accountant');

r.get('/',                requireFinance, viewer, ctrl.list);
r.get('/:id',             requireFinance, viewer, ctrl.getOne);
r.post('/',               requireFinance, editor, ctrl.create);
r.patch('/:id',           requireFinance, editor, ctrl.update);
r.patch('/:id/date',      requireFinance, editor, ctrl.patchDate);
r.post('/:id/post',       requireFinance, editor, ctrl.post);
r.post('/:id/void',       requireFinance, editor, ctrl.voidOne);
r.post('/bulk-import',    requireFinance, editor, ctrl.bulkImport);

module.exports = r;
