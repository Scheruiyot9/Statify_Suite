const svc = require('./companies.service');

const list = async (req, res) => {
  const result = await svc.listCompanies(req.query);
  res.json({ success: true, data: result });
};

const getOne = async (req, res) => {
  const company = await svc.getCompany(req.params.id);
  res.json({ success: true, data: company });
};

const create = async (req, res) => {
  const result = await svc.createCompany(req.body);
  res.status(201).json({ success: true, data: result });
};

const update = async (req, res) => {
  const company = await svc.updateCompany(req.params.id, req.body);
  res.json({ success: true, data: company });
};

const updateStatus = async (req, res) => {
  const company = await svc.updateSubscriptionStatus(req.params.id, req.body);
  res.json({ success: true, data: company });
};

const remove = async (req, res) => {
  const result = await svc.deleteCompany(req.params.id);
  res.json({ success: true, data: result, message: `${result.company_name} deleted` });
};

const listPlans = async (_req, res) => {
  const plans = await svc.listSubscriptionPlans();
  res.json({ success: true, data: plans });
};

const getMine = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.json({ success: true, data: null });
  const company = await svc.getMyCompany(companyId);
  res.json({ success: true, data: company });
};

const getLoyaltySettings = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  const settings = await svc.getLoyaltySettings(companyId);
  res.json({ success: true, data: settings });
};

const updateLoyaltySettings = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  const settings = await svc.updateLoyaltySettings(companyId, req.body);
  res.json({ success: true, data: settings });
};

const resetCustomerLoyaltyPoints = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  const result = await svc.resetCustomerLoyaltyPoints(companyId);
  res.json({ success: true, data: result });
};

const updateMyProfile = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  const company = await svc.updateMyProfile(companyId, req.body);
  res.json({ success: true, data: company });
};

const getMySubscription = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  const data = await svc.getMySubscription(companyId);
  res.json({ success: true, data });
};

const requestUpgrade = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  await svc.requestUpgrade(companyId, req.body);
  res.json({ success: true, message: 'Upgrade request sent. Our team will contact you shortly.' });
};

const submitSubscriptionRequest = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  const result = await svc.submitSubscriptionRequest(companyId, req.body);
  res.status(201).json({ success: true, data: result });
};

const listMySubscriptionRequests = async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ success: false, message: 'No company context' });
  const result = await svc.listMySubscriptionRequests(companyId, req.query);
  res.json({ success: true, data: result });
};

module.exports = {
  list, getOne, create, update, updateStatus, remove,
  listPlans, getMine, updateMyProfile, getLoyaltySettings, updateLoyaltySettings,
  resetCustomerLoyaltyPoints,
  getMySubscription, requestUpgrade,
  submitSubscriptionRequest, listMySubscriptionRequests,
};
