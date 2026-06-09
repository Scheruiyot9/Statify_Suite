const svc = require('./products.service');

const list = async (req, res) => {
  const { branchId, search, categoryId, isActive, page, limit } = req.query;
  const result = await svc.listProducts(req.tenantId, { branchId, search, categoryId, isActive, page, limit });
  res.json({ success: true, data: result });
};

const getOne = async (req, res) => {
  const { branchId } = req.query;
  const product = await svc.getProductById(req.tenantId, req.params.id, branchId);
  res.json({ success: true, data: product });
};

const listCategories = async (req, res) => {
  const categories = await svc.listCategories(req.tenantId);
  res.json({ success: true, data: categories });
};

const create = async (req, res) => {
  const product = await svc.createProduct(req.tenantId, req.body);
  res.status(201).json({ success: true, data: product });
};

const update = async (req, res) => {
  const product = await svc.updateProduct(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: product });
};

const createCategory = async (req, res) => {
  const category = await svc.createCategory(req.tenantId, req.body);
  res.status(201).json({ success: true, data: category });
};

const updateCategory = async (req, res) => {
  const category = await svc.updateCategory(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: category });
};

const remove = async (req, res) => {
  await svc.deleteProduct(req.tenantId, req.params.id, req.user.userId);
  res.json({ success: true, message: 'Product deleted' });
};

const listBranchPricing = async (req, res) => {
  const pricing = await svc.listBranchPricing(req.tenantId, req.params.id);
  res.json({ success: true, data: pricing });
};

const upsertBranchPricing = async (req, res) => {
  const result = await svc.upsertBranchPricing(req.tenantId, req.params.id, req.body);
  res.json({ success: true, data: result });
};

const importProducts = async (req, res) => {
  const result = await svc.bulkImportProducts(req.tenantId, req.body.products);
  res.status(200).json({ success: true, data: result });
};

module.exports = { list, getOne, listCategories, create, update, createCategory, updateCategory, remove, listBranchPricing, upsertBranchPricing, importProducts };
