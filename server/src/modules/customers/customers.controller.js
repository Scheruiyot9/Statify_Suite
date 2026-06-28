const svc = require('./customers.service');

const list = async (req, res) => {
  const { search, groupId, phone, customerId, creditOutstanding, page, limit } = req.query;
  const result = await svc.listCustomers(req.tenantId, { search, groupId, phone, customerId, creditOutstanding, page, limit });
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

const creditTransactions = async (req, res) => {
  const rows = await svc.listCreditTransactions(req.tenantId, req.params.id);
  res.json({ success: true, data: rows });
};

const creditPayment = async (req, res) => {
  const { amount, paymentMethodId, sessionId, transactionIds } = req.body;
  const result = await svc.recordCreditPayment(
    req.tenantId, req.params.id,
    parseFloat(amount), paymentMethodId || null, sessionId || null,
    Array.isArray(transactionIds) && transactionIds.length ? transactionIds : null
  );
  res.json({ success: true, data: result });
};

const recalculateCreditBalance = async (req, res) => {
  const result = await svc.recalculateCreditBalance(req.tenantId, req.params.id);
  res.json({ success: true, data: result });
};

const customerLedger = async (req, res) => {
  try {
    const result = await svc.getCustomerLedger(req.tenantId, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[customerLedger] error:', err.message, err.stack);
    // Temporary: expose real error so we can diagnose the 500
    res.status(500).json({ success: false, message: err.message, code: err.code || null });
  }
};

module.exports = { list, getOne, create, update, listGroups, createGroup, updateGroup, remove, creditTransactions, creditPayment, recalculateCreditBalance, customerLedger };
