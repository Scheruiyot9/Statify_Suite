const svc = require('./returns.service');
const { ok, created } = require('../../shared/response');

const listReasons = async (req, res) => {
  const reasons = await svc.listReturnReasons(req.tenantId);
  ok(res, reasons);
};

const createReason = async (req, res) => {
  const reason = await svc.createReturnReason(req.tenantId, req.body);
  created(res, reason);
};

const updateReason = async (req, res) => {
  const reason = await svc.updateReturnReason(req.tenantId, req.params.id, req.body);
  ok(res, reason);
};

const deleteReason = async (req, res) => {
  await svc.deleteReturnReason(req.tenantId, req.params.id);
  ok(res, { deleted: true });
};

const list = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const result = await svc.listReturns(req.tenantId, role, branchIds, req.query);
  res.json({ success: true, data: result });
};

const getOne = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const ret = await svc.getReturn(req.tenantId, req.params.id, role, branchIds);
  ok(res, ret);
};

const create = async (req, res) => {
  const { userId, branchIds = [] } = req.user;
  const branchId = req.body.branchId || branchIds[0];
  const ret = await svc.createReturn(req.tenantId, branchId, userId, req.body);
  created(res, ret);
};

const approve = async (req, res) => {
  const { userId } = req.user;
  const result = await svc.approveReturn(req.tenantId, req.params.id, userId, req.body.approvalNotes);
  ok(res, result);
};

const reject = async (req, res) => {
  const { userId } = req.user;
  const result = await svc.rejectReturn(req.tenantId, req.params.id, userId, req.body.rejectionNotes);
  ok(res, result);
};

const markRefunded = async (req, res) => {
  const { userId } = req.user;
  const result = await svc.markRefunded(req.tenantId, req.params.id, userId, req.body.refundNotes);
  ok(res, result);
};

module.exports = { listReasons, createReason, updateReason, deleteReason, list, getOne, create, approve, reject, markRefunded };
