const svc = require('./tax.service');

const list    = async (req, res) => { res.json({ success: true, data: await svc.listTaxRates(req.tenantId) }); };
const create  = async (req, res) => { res.status(201).json({ success: true, data: await svc.createTaxRate(req.tenantId, req.body) }); };
const update  = async (req, res) => { res.json({ success: true, data: await svc.updateTaxRate(req.tenantId, req.params.id, req.body) }); };
const remove  = async (req, res) => { await svc.deleteTaxRate(req.tenantId, req.params.id); res.json({ success: true, message: 'Tax rate deleted' }); };
const getDefault = async (req, res) => { res.json({ success: true, data: await svc.getDefaultTaxRate(req.tenantId) }); };

module.exports = { list, create, update, remove, getDefault };
