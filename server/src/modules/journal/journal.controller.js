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

const postDailySummary  = async (req, res) => {
  const { branchId, date, mode = 'combined' } = req.body;
  if (!branchId || !date) throw new Error('branchId and date are required');
  if (mode === 'per_transaction') {
    const result = await svc.postUnpostedPerTransaction(req.tenantId, branchId, date, req.user.userId);
    return ok(res, result);
  }
  const result = await svc.postDailySummaryEntry(req.tenantId, branchId, date, req.user.userId);
  created(res, { journalEntryId: result });
};

module.exports = { openingBalances, arAging, arSettlement, unreconciledLines, reconcile, postDailySummary };
