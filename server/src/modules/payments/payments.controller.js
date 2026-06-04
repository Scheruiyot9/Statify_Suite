const svc = require('./payments.service');
const { ok, created } = require('../../shared/response');

const list        = async (req, res) => ok(res, await svc.listPayments(req.tenantId, req.query));
const getOne      = async (req, res) => ok(res, await svc.getPayment(req.tenantId, req.params.id));
const create      = async (req, res) => created(res, await svc.createPayment(req.tenantId, req.user.userId, req.body));
const voidPayment = async (req, res) => ok(res, await svc.voidPayment(req.tenantId, req.params.id, req.user.userId));

module.exports = { list, getOne, create, voidPayment };
