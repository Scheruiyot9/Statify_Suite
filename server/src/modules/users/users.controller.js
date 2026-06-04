const svc = require('./users.service');

const list = async (req, res) => {
  const result = await svc.listUsers(req.tenantId, req.query);
  res.json({ success: true, data: result });
};

const roles = async (req, res) => {
  const result = await svc.listRoles(req.tenantId);
  res.json({ success: true, data: result });
};

const rolesWithPermissions = async (req, res) => {
  const result = await svc.listRolesWithPermissions(req.tenantId);
  res.json({ success: true, data: result });
};

const create = async (req, res) => {
  const user = await svc.createUser(req.tenantId, req.body);
  res.status(201).json({ success: true, data: user });
};

const update = async (req, res) => {
  const user = await svc.updateUser(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: user });
};

const resetPwd = async (req, res) => {
  await svc.resetPassword(req.tenantId, req.params.id, req.body);
  res.json({ success: true, message: 'Password reset successfully' });
};

const remove = async (req, res) => {
  await svc.deleteUser(req.tenantId, req.params.id, req.user.userId);
  res.json({ success: true, message: 'User deleted' });
};

const clearPin = async (req, res) => {
  await svc.clearPin(req.tenantId, req.params.id);
  res.json({ success: true, message: 'PIN cleared — user must set a new PIN before unlocking' });
};

module.exports = { list, roles, rolesWithPermissions, create, update, resetPwd, remove, clearPin };
