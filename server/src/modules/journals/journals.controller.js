const svc = require('./journals.service');
const { ok, created } = require('../../shared/response');

const list       = async (req, res) => ok(res, await svc.listJournals(req.tenantId, req.query));
const getOne     = async (req, res) => ok(res, await svc.getJournal(req.tenantId, req.params.id));
const create     = async (req, res) => created(res, await svc.createJournal(req.tenantId, req.user.userId, req.body));
const update     = async (req, res) => ok(res, await svc.updateJournal(req.tenantId, req.params.id, req.user.userId, req.body));
const post       = async (req, res) => ok(res, await svc.postJournal(req.tenantId, req.params.id, req.user.userId));
const voidOne    = async (req, res) => ok(res, await svc.voidJournal(req.tenantId, req.params.id, req.user.userId, req.body.reason));
const bulkImport = async (req, res) => created(res, await svc.bulkImportJournals(req.tenantId, req.user.userId, req.body.entries));

module.exports = { list, getOne, create, update, post, voidOne, bulkImport };
