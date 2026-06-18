const svc = require('./pos.service');
const { resolveBranchId } = require('../../shared/roles');

// ── POS Product Catalog ───────────────────────────────────────────────────────

const products = async (req, res) => {
  const branchId = resolveBranchId(req);
  const { search, categoryId, page, limit } = req.query;
  const result = await svc.listSellableProducts(req.tenantId, {
    branchId,
    search,
    categoryId,
    page,
    limit,
  });
  res.json({ success: true, data: result });
};

// ── Payment Methods ───────────────────────────────────────────────────────────

const paymentMethods = async (req, res) => {
  const includeInactive = req.query.all === 'true';
  const methods = await svc.listPaymentMethods(req.tenantId, includeInactive);
  res.json({ success: true, data: methods });
};

const createPaymentMethod = async (req, res) => {
  const method = await svc.createPaymentMethod(req.tenantId, req.body);
  res.status(201).json({ success: true, data: method });
};

const updatePaymentMethod = async (req, res) => {
  const method = await svc.updatePaymentMethod(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: method });
};

const deletePaymentMethod = async (req, res) => {
  await svc.deletePaymentMethod(req.tenantId, req.params.id);
  res.json({ success: true, message: 'Payment method deleted' });
};

// ── Terminals ─────────────────────────────────────────────────────────────────

// POS cashier: auto-seeds a default till when none exist for the branch
const terminals = async (req, res) => {
  const branchId = resolveBranchId(req);
  const list = await svc.listTerminals(req.tenantId, branchId);
  res.json({ success: true, data: list });
};

// Settings: all terminals with branch info, optional branch filter
const allTerminals = async (req, res) => {
  const { branchId, includeInactive } = req.query;
  const list = await svc.listAllTerminals(req.tenantId, {
    branchId:       branchId || null,
    includeInactive: includeInactive === 'true',
  });
  res.json({ success: true, data: list });
};

const createTerminal = async (req, res) => {
  const terminal = await svc.createTerminal(req.tenantId, req.body);
  res.status(201).json({ success: true, data: terminal });
};

const updateTerminal = async (req, res) => {
  const terminal = await svc.updateTerminal(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: terminal });
};

const deleteTerminal = async (req, res) => {
  await svc.deleteTerminal(req.tenantId, req.params.id);
  res.json({ success: true, message: 'Terminal deactivated' });
};

// ── Sessions ──────────────────────────────────────────────────────────────────

const activeSession = async (req, res) => {
  const branchId = resolveBranchId(req);
  const session = await svc.getActiveSession(req.tenantId, req.user.userId, branchId, req.user.role);
  res.json({ success: true, data: session });
};

const openSession = async (req, res) => {
  const branchId = resolveBranchId(req);
  const session = await svc.openSession(req.tenantId, branchId, req.user.userId, req.body);
  res.status(201).json({ success: true, data: session });
};

const sessionSummary = async (req, res) => {
  const summary = await svc.getSessionSummary(req.tenantId, req.params.id);
  res.json({ success: true, data: summary });
};

const closeSession = async (req, res) => {
  const result = await svc.closeSession(req.tenantId, req.params.id, req.user.userId, req.body);
  res.json({ success: true, data: result });
};

// ── Shifts Management ─────────────────────────────────────────────────────────

const listSessions = async (req, res) => {
  const { branchId, status, cashierId, startDate, endDate, page, limit } = req.query;
  const effectiveBranchId = branchId || req.user.branchIds?.[0];
  const result = await svc.listSessions(req.tenantId, {
    branchId: effectiveBranchId,
    status,
    cashierId,
    startDate,
    endDate,
    page: page || 1,
    limit: limit || 25,
  });
  res.json({ success: true, data: result });
};

const sessionDetail = async (req, res) => {
  const detail = await svc.getSessionDetail(req.tenantId, req.params.id);
  res.json({ success: true, data: detail });
};

const forceCloseSession = async (req, res) => {
  const result = await svc.forceCloseSession(req.tenantId, req.params.id, req.user.userId, req.body);
  res.json({ success: true, data: result });
};

const correctSession = async (req, res) => {
  const result = await svc.correctSession(req.tenantId, req.params.id, req.user.userId, req.body);
  res.json({ success: true, data: result });
};

const expenseAccounts = async (req, res) => {
  const { rows } = await require('../../config/database').query(
    `SELECT account_id, account_code, account_name, account_type
     FROM accounts
     WHERE company_id = $1 AND is_active = TRUE
       AND account_type IN ('expense','asset','liability')
     ORDER BY account_code`,
    [req.tenantId]
  );
  res.json({ success: true, data: rows });
};

const cashOut = async (req, res) => {
  const hasFinance = req.user?.planFeatures?.hasFinance === true;
  const result = await svc.recordCashOut(req.tenantId, req.params.id, req.user.userId, req.body, hasFinance);
  res.status(201).json({ success: true, data: result });
};

const cashOuts = async (req, res) => {
  const result = await svc.listCashOuts(req.tenantId, req.params.id);
  res.json({ success: true, data: result });
};

const allCashOuts = async (req, res) => {
  const { startDate, endDate, branchId, page, limit } = req.query;
  const result = await svc.listAllCashOuts(req.tenantId, {
    startDate, endDate, branchId,
    page:  page  ? parseInt(page,  10) : 1,
    limit: limit ? parseInt(limit, 10) : 30,
  });
  res.json({ success: true, data: result });
};

// ── Pay Mode Transfers ────────────────────────────────────────────────────────

const createTransfer = async (req, res) => {
  const result = await svc.createTransfer(req.tenantId, req.params.id, req.user.userId, req.body);
  res.status(201).json({ success: true, data: result });
};

const listTransfers = async (req, res) => {
  const result = await svc.listTransfers(req.tenantId, req.params.id);
  res.json({ success: true, data: result });
};

// ── Hold Carts ────────────────────────────────────────────────────────────────

const createHold = async (req, res) => {
  const branchId = resolveBranchId(req);
  const result = await svc.createHold(req.tenantId, branchId, req.user.userId, req.body);
  res.status(201).json({ success: true, data: result });
};

const listHolds = async (req, res) => {
  const branchId = resolveBranchId(req);
  const result = await svc.listHolds(req.tenantId, branchId);
  res.json({ success: true, data: result });
};

const deleteHold = async (req, res) => {
  await svc.deleteHold(req.tenantId, req.params.id);
  res.json({ success: true });
};

module.exports = {
  products,
  paymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  terminals, allTerminals, createTerminal, updateTerminal, deleteTerminal,
  activeSession, openSession, sessionSummary, closeSession,
  listSessions, sessionDetail, forceCloseSession, correctSession,
  cashOut, cashOuts, allCashOuts, expenseAccounts,
  createTransfer, listTransfers,
  createHold, listHolds, deleteHold,
};
