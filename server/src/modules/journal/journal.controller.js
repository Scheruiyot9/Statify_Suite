const svc = require('./journal.service');
const { ok, created } = require('../../shared/response');

const openingBalances   = async (req, res) =>
  created(res, await svc.postBulkOpeningBalance(req.tenantId, req.user.userId, req.body.entries));

const arAging           = async (req, res) => ok(res, await svc.getArAging(req.tenantId));
const arSettlement      = async (req, res) =>
  created(res, await svc.postArSettlementEntry(req.tenantId, req.user.userId, req.body));

const unreconciledLines = async (req, res) =>
  ok(res, await svc.getUnreconciledLines(req.tenantId, req.query));
const reconcile         = async (req, res) =>
  ok(res, await svc.reconcileLines(req.tenantId, req.user.userId, req.body.lineIds));

module.exports = { openingBalances, arAging, arSettlement, unreconciledLines, reconcile };
