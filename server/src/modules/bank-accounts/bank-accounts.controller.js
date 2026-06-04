const svc = require('./bank-accounts.service');
const { ok, created } = require('../../shared/response');

const list   = async (req, res) => ok(res, await svc.listBankAccounts(req.tenantId));
const getOne = async (req, res) => ok(res, await svc.getBankAccount(req.tenantId, req.params.id));
const create = async (req, res) => created(res, await svc.createBankAccount(req.tenantId, req.body));
const update = async (req, res) => ok(res, await svc.updateBankAccount(req.tenantId, req.params.id, req.body));
const remove = async (req, res) => ok(res, await svc.deleteBankAccount(req.tenantId, req.params.id));

const ledger = async (req, res) => ok(res, await svc.getBankAccountLedger(req.tenantId, req.params.id, req.query));

module.exports = { list, getOne, create, update, remove, ledger };
