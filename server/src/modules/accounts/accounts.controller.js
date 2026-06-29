const svc        = require('./accounts.service');
const journalSvc = require('../journal/journal.service');
const { ok, created } = require('../../shared/response');

const list   = async (req, res) => ok(res, await svc.listAccounts(req.tenantId));
const getOne = async (req, res) => ok(res, await svc.getAccount(req.tenantId, req.params.id));
const create = async (req, res) => created(res, await svc.createAccount(req.tenantId, req.body));
const update = async (req, res) => ok(res, await svc.updateAccount(req.tenantId, req.params.id, req.body));
const remove = async (req, res) => ok(res, await svc.deleteAccount(req.tenantId, req.params.id));
const seed   = async (req, res) => ok(res, await svc.seedDefaults(req.tenantId));

const balance      = async (req, res) => ok(res, await svc.getAccountBalance(req.tenantId, req.params.id));
const ledger       = async (req, res) => ok(res, await svc.getAccountLedger(req.tenantId, req.params.id, req.query));
const journalEntry  = async (req, res) => ok(res, await svc.getJournalEntry(req.tenantId, req.params.entryId));
const voidEntry     = async (req, res) => ok(res, await journalSvc.voidJournalEntry(req.tenantId, req.params.entryId, req.user.userId, req.body.reason));
const patchEntryDate = async (req, res) => ok(res, await svc.patchEntryDate(req.tenantId, req.params.entryId, req.body.entryDate));

module.exports = { list, getOne, create, update, remove, seed, balance, ledger, journalEntry, voidEntry, patchEntryDate };
