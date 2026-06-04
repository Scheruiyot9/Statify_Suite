const svc = require('./inventory.service');

const list = async (req, res) => {
  const { role, branchIds = [] } = req.user;
  const result = await svc.listInventory(req.tenantId, role, branchIds, req.query);
  res.json({ success: true, data: result });
};

const adjust = async (req, res) => {
  const { userId } = req.user;
  const result = await svc.adjustStock(req.tenantId, userId, req.body);
  res.json({ success: true, data: result });
};

const setReorder = async (req, res) => {
  const { productId, branchId } = req.params;
  const result = await svc.updateReorderLevel(req.tenantId, productId, branchId, req.body);
  res.json({ success: true, data: result });
};

module.exports = { list, adjust, setReorder };
