const svc = require('./customers.service');

const list = async (req, res) => {
  const { search, groupId, phone, customerId, page, limit } = req.query;
  const result = await svc.listCustomers(req.tenantId, { search, groupId, phone, customerId, page, limit });
  res.json({ success: true, data: result });
};

const getOne = async (req, res) => {
  const customer = await svc.getCustomer(req.tenantId, req.params.id);
  res.json({ success: true, data: customer });
};

const create = async (req, res) => {
  const customer = await svc.createCustomer(req.tenantId, req.body);
  res.status(201).json({ success: true, data: customer });
};

const update = async (req, res) => {
  const customer = await svc.updateCustomer(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: customer });
};

const listGroups = async (req, res) => {
  const groups = await svc.listGroups(req.tenantId);
  res.json({ success: true, data: groups });
};

const createGroup = async (req, res) => {
  const group = await svc.createGroup(req.tenantId, req.body);
  res.status(201).json({ success: true, data: group });
};

const updateGroup = async (req, res) => {
  const group = await svc.updateGroup(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: group });
};

const remove = async (req, res) => {
  await svc.deleteCustomer(req.tenantId, req.params.id, req.user.userId);
  res.json({ success: true, message: 'Customer deleted' });
};

const creditPayment = async (req, res) => {
  const { amount, notes } = req.body;
  const result = await svc.recordCreditPayment(req.tenantId, req.params.id, parseFloat(amount), notes);
  res.json({ success: true, data: result });
};

module.exports = { list, getOne, create, update, listGroups, createGroup, updateGroup, remove, creditPayment };
