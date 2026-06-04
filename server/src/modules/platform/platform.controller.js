const svc        = require('./platform.service');
const reportsSvc = require('../reports/reports.service');
const journalSvc = require('../journal/journal.service');

const r = (res, data, status = 200) => res.status(status).json({ success: true, data });

// Overview
const stats          = async (req, res) => r(res, await svc.platformStats());

// Platform-wide stock valuation (all companies or filtered by ?companyId)
const platformStockValuation = async (req, res) => r(res, await svc.platformStockValuation(req.query));

// Subscription Plans
const listPlans      = async (req, res) => r(res, await svc.listPlans());
const createPlan     = async (req, res) => r(res, await svc.createPlan(req.body), 201);
const updatePlan     = async (req, res) => r(res, await svc.updatePlan(req.params.id, req.body));
const deletePlan     = async (req, res) => r(res, await svc.deletePlan(req.params.id));

// Companies
const companies           = async (req, res) => r(res, await svc.listAllCompanies(req.query));
const changeCompanyPlan   = async (req, res) => r(res, await svc.changeCompanyPlan(req.params.id, req.body.plan_id));
const changeCompanyStatus = async (req, res) => r(res, await svc.changeCompanyStatus(req.params.id, req.body.status));

// People
const users          = async (req, res) => r(res, await svc.listAllUsers(req.query));
const branches       = async (req, res) => r(res, await svc.listAllBranches(req.query));

// POS Activity
const terminals      = async (req, res) => r(res, await svc.listAllTerminals(req.query));
const sessions       = async (req, res) => r(res, await svc.listAllSessions(req.query));
const sales          = async (req, res) => r(res, await svc.listAllSales(req.query));

// Catalog
const products       = async (req, res) => r(res, await svc.listAllProducts(req.query));
const inventory      = async (req, res) => r(res, await svc.listAllInventory(req.query));

// CRM
const customers      = async (req, res) => r(res, await svc.listAllCustomers(req.query));
const paymentMethods = async (req, res) => r(res, await svc.listAllPaymentMethods(req.query));

// M-Pesa
const mpesa             = async (req, res) => r(res, await svc.listAllMpesaTransactions(req.query));
const mpesaConfigs      = async (req, res) => r(res, await svc.listAllMpesaConfigs(req.query));
const saveMpesaConfig   = async (req, res) => r(res, await svc.saveMpesaConfig(req.body.companyId, req.body), 201);
const toggleMpesaConfig = async (req, res) => r(res, await svc.toggleMpesaConfig(req.params.id));

// Finance
const suppliers    = async (req, res) => r(res, await svc.listAllSuppliers(req.query));
const purchases    = async (req, res) => r(res, await svc.listAllPurchases(req.query));
const apPayments   = async (req, res) => r(res, await svc.listAllApPayments(req.query));
const accounts     = async (req, res) => r(res, await svc.listAllAccounts(req.query));
const bankAccounts = async (req, res) => r(res, await svc.listAllBankAccounts(req.query));
const journals     = async (req, res) => r(res, await svc.listAllJournals(req.query));

// Subscriptions
const listSubscriptions  = async (req, res) => r(res, await svc.listSubscriptions(req.query));
const recordSubscription = async (req, res) => r(res, await svc.recordSubscription(
  req.body.companyId, req.body, req.user?.userId
), 201);

// Subscription Requests
const listSubscriptionRequests  = async (req, res) => r(res, await svc.listSubscriptionRequests(req.query));
const actionSubscriptionRequest = async (req, res) => r(res, await svc.actionSubscriptionRequest(
  req.params.id, req.body, req.user?.userId
));

// Super-admin user creation + platform-level edit (no company context required)
const createSuperAdminUser = async (req, res) => r(res, await svc.createSuperAdmin(req.body), 201);
const updateAnyUser        = async (req, res) => r(res, await svc.updateAnyUser(req.params.id, req.body));

// Sales Report — platform-wide with optional ?companyId filter
const platformSalesReport = async (req, res) => {
  const { companyId, startDate, endDate } = req.query;
  r(res, await reportsSvc.getSalesReport(companyId || null, 'super_admin', [], { startDate, endDate }));
};

// Finance Reports — platform-wide with optional ?companyId filter
const platformPLReport      = async (req, res) => {
  const { companyId, startDate, endDate } = req.query;
  r(res, await reportsSvc.getPLReport(companyId || null, { startDate, endDate }));
};
const platformCashFlow      = async (req, res) => {
  const { companyId, startDate, endDate } = req.query;
  r(res, await reportsSvc.getCashFlowStatement(companyId || null, { startDate, endDate }));
};
const platformAPAging       = async (req, res) => {
  const { companyId } = req.query;
  r(res, await reportsSvc.getAPAging(companyId || null));
};
const platformBalanceSheet  = async (req, res) => {
  const { companyId } = req.query;
  r(res, await reportsSvc.getBalanceSheet(companyId || null));
};
const platformARAgingReport = async (req, res) => {
  const { companyId } = req.query;
  r(res, await journalSvc.getArAging(companyId || null));
};

module.exports = {
  stats,
  listPlans, createPlan, updatePlan, deletePlan,
  companies, changeCompanyPlan, changeCompanyStatus,
  users, branches,
  terminals, sessions, sales,
  products, inventory,
  customers, paymentMethods,
  mpesa, mpesaConfigs, saveMpesaConfig, toggleMpesaConfig,
  suppliers, purchases, apPayments, accounts, bankAccounts, journals,
  listSubscriptions, recordSubscription,
  listSubscriptionRequests, actionSubscriptionRequest,
  createSuperAdminUser, updateAnyUser,
  platformSalesReport,
  platformPLReport, platformCashFlow, platformAPAging, platformBalanceSheet, platformARAgingReport,
  platformStockValuation,
};
