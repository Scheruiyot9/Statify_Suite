const svc = require('./mpesa.service');
const { resolveBranchId } = require('../../shared/roles');

// ── Config ────────────────────────────────────────────────────────────────────

const getConfig = async (req, res) => {
  const config = await svc.getConfigForCompany(req.tenantId);
  res.json({ success: true, data: config });
};

const saveConfig = async (req, res) => {
  const { branchId, ...rest } = req.body;
  const config = await svc.saveConfig(req.tenantId, branchId || null, rest);
  res.json({ success: true, data: config });
};

// ── STK Push ──────────────────────────────────────────────────────────────────

const stkPush = async (req, res) => {
  const branchId = resolveBranchId(req, { from: ['body'], required: false });
  const result   = await svc.initiateSTKPush(req.tenantId, branchId, req.body);
  res.status(202).json({ success: true, data: result });
};

const stkStatus = async (req, res) => {
  const result = await svc.querySTKStatus(req.tenantId, req.params.checkoutRequestId);
  res.json({ success: true, data: result });
};

// ── Daraja callbacks — no auth, must respond 200 before processing ────────────

const callback = async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  svc.processCallback(req.body).catch((err) =>
    console.error('[mpesa-callback]', err.message)
  );
};

// C2B validation — Daraja asks "should I accept this payment?" — always say yes
const c2bValidate = (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

// C2B confirmation — Daraja confirms the payment has been received
const c2bConfirm = async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  svc.processC2BCallback(req.body).catch((err) =>
    console.error('[mpesa-c2b]', err.message)
  );
};

// Register C2B URLs with Daraja (admin, one-time per shortcode)
const registerC2B = async (req, res) => {
  const branchId = resolveBranchId(req, { from: ['body'], required: false });
  const result   = await svc.registerC2BUrl(req.tenantId, branchId);
  res.json({ success: true, data: result });
};

// ── Manual receipt entry ──────────────────────────────────────────────────────

const manualEntry = async (req, res) => {
  const branchId = resolveBranchId(req, { from: ['body'], required: false });
  const result   = await svc.recordManualPayment(req.tenantId, branchId, req.body);
  res.status(201).json({ success: true, data: result });
};

// ── Unlinked payments lookup ──────────────────────────────────────────────────

const unlinked = async (req, res) => {
  const { amount, hours } = req.query;
  const results = await svc.listUnlinked(req.tenantId, { amount, hours });
  res.json({ success: true, data: results });
};

// ── Link to sale (called after createTransaction succeeds) ────────────────────

const linkToSale = async (req, res) => {
  await svc.linkToSale(req.tenantId, req.params.id, req.body.salesTransactionId);
  res.json({ success: true });
};

// ── Transaction listing ───────────────────────────────────────────────────────

const list = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const result = await svc.listTransactions(req.tenantId, role, branchIds, req.query);
  res.json({ success: true, data: result });
};

module.exports = { getConfig, saveConfig, stkPush, stkStatus, callback, c2bValidate, c2bConfirm, registerC2B, manualEntry, unlinked, linkToSale, list };
