const svc = require('./sales.service');
const { resolveBranchId } = require('../../shared/roles');

function resolveSalesBranchId(req) {
  return resolveBranchId(req, { from: ['body'], required: false });
}

const list = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const result = await svc.listTransactions(req.tenantId, role, branchIds, req.query);
  res.json({ success: true, data: result });
};

const getOne = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const txn = await svc.getTransaction(req.tenantId, req.params.id, role, branchIds);
  res.json({ success: true, data: txn });
};

const create = async (req, res) => {
  const { userId } = req.user;
  const branchId = resolveSalesBranchId(req);
  const txn = await svc.createTransaction(req.tenantId, branchId, userId, req.body);
  res.status(201).json({ success: true, data: txn });
};

const voidOne = async (req, res) => {
  const { userId, role, branchIds = [] } = req.user;
  await svc.voidTransaction(req.tenantId, req.params.id, userId, req.body.reason, role, branchIds);
  res.json({ success: true, message: 'Transaction voided' });
};

module.exports = { list, getOne, create, voidOne };
