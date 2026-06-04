const svc = require('./branches.service');

const list = async (req, res) => {
  const branches = await svc.listBranches(req.tenantId);
  res.json({ success: true, data: branches });
};

const create = async (req, res) => {
  const branch = await svc.createBranch(req.tenantId, req.body);
  res.status(201).json({ success: true, data: branch });
};

const update = async (req, res) => {
  const branch = await svc.updateBranch(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: branch });
};

const remove = async (req, res) => {
  await svc.deleteBranch(req.tenantId, req.params.id, req.user.userId);
  res.json({ success: true, message: 'Branch deleted' });
};

module.exports = { list, create, update, remove };
