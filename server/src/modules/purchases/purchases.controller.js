const svc = require('./purchases.service');
const { ok, created } = require('../../shared/response');

// ── Purchase Orders ───────────────────────────────────────────────────────────
const listPOs   = async (req, res) => ok(res, await svc.listPOs(req.tenantId, req.query));
const getPO     = async (req, res) => ok(res, await svc.getPO(req.tenantId, req.params.id));
const createPO  = async (req, res) => created(res, await svc.createPO(req.tenantId, req.user.userId, req.body));
const updatePO  = async (req, res) => ok(res, await svc.updatePO(req.tenantId, req.params.id, req.body));
const submitPO  = async (req, res) => ok(res, await svc.submitPO(req.tenantId, req.params.id));
const approvePO = async (req, res) => ok(res, await svc.approvePO(req.tenantId, req.params.id, req.user.userId));
const cancelPO  = async (req, res) => ok(res, await svc.cancelPO(req.tenantId, req.params.id));

// ── Goods Received Notes ──────────────────────────────────────────────────────
const listGRNs  = async (req, res) => ok(res, await svc.listGRNs(req.tenantId, req.query));
const getGRN    = async (req, res) => ok(res, await svc.getGRN(req.tenantId, req.params.id));
const createGRN = async (req, res) => created(res, await svc.createGRN(req.tenantId, req.user.userId, req.body));
const postGRN   = async (req, res) => ok(res, await svc.postGRN(req.tenantId, req.params.id, req.user.userId));
const deleteGRN = async (req, res) => ok(res, await svc.deleteGRN(req.tenantId, req.params.id));

module.exports = { listPOs, getPO, createPO, updatePO, submitPO, approvePO, cancelPO, listGRNs, getGRN, createGRN, postGRN, deleteGRN };
