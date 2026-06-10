const {
  getDashboard, getSalesReport,
  getPLReport, getAPAging, getBalanceSheet, getCashFlowStatement,
  getStockValuation, getPurchasesSummary,
  getLPOReport, getGRNReport, getTrialBalance, getLedgerEntries,
  getProductQty,
} = require('./reports.service');

const dashboard = async (req, res) => {
  const companyId = req.tenantId || null;
  const { role, branchIds = [] } = req.user;
  const { period = '7d' } = req.query;
  const data = await getDashboard(companyId, role, branchIds, { period });
  res.json({ success: true, data });
};

const salesReport = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const { startDate, endDate, branchId } = req.query;
  const data = await getSalesReport(req.tenantId, role, branchIds, { startDate, endDate, branchId });
  res.json({ success: true, data });
};

const plReport = async (req, res) => {
  const data = await getPLReport(req.tenantId, req.query);
  res.json({ success: true, data });
};

const apAging = async (req, res) => {
  const data = await getAPAging(req.tenantId);
  res.json({ success: true, data });
};

const balanceSheet = async (req, res) => {
  const data = await getBalanceSheet(req.tenantId);
  res.json({ success: true, data });
};

const stockValuation = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const data = await getStockValuation(req.tenantId, role, branchIds, req.query);
  res.json({ success: true, data });
};

const purchasesSummary = async (req, res) => {
  const data = await getPurchasesSummary(req.tenantId, req.query);
  res.json({ success: true, data });
};

const lpoReport = async (req, res) => {
  const data = await getLPOReport(req.tenantId, req.query);
  res.json({ success: true, data });
};

const grnReport = async (req, res) => {
  const data = await getGRNReport(req.tenantId, req.query);
  res.json({ success: true, data });
};

const trialBalance = async (req, res) => {
  const data = await getTrialBalance(req.tenantId, req.query);
  res.json({ success: true, data });
};

const ledgerEntries = async (req, res) => {
  const data = await getLedgerEntries(req.tenantId, req.query);
  res.json({ success: true, data });
};

const cashFlow = async (req, res) => {
  const data = await getCashFlowStatement(req.tenantId, req.query);
  res.json({ success: true, data });
};

const productQty = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const { period = '7d' } = req.query;
  const data = await getProductQty(req.tenantId, role, branchIds, { period });
  res.json({ success: true, data });
};

module.exports = { dashboard, salesReport, plReport, apAging, balanceSheet, cashFlow, stockValuation, purchasesSummary, lpoReport, grnReport, trialBalance, ledgerEntries, productQty };
