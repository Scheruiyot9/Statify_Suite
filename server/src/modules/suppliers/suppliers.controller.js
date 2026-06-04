const svc = require('./suppliers.service');
const { ok, created } = require('../../shared/response');

const list   = async (req, res) => ok(res, await svc.listSuppliers(req.tenantId, req.query));
const getOne = async (req, res) => ok(res, await svc.getSupplier(req.tenantId, req.params.id));
const create = async (req, res) => created(res, await svc.createSupplier(req.tenantId, req.body));
const update = async (req, res) => ok(res, await svc.updateSupplier(req.tenantId, req.params.id, req.body));
const remove = async (req, res) => ok(res, await svc.deleteSupplier(req.tenantId, req.params.id));
const ledger = async (req, res) => ok(res, await svc.getSupplierLedger(req.tenantId, req.params.id, req.query));

module.exports = { list, getOne, create, update, remove, ledger };
