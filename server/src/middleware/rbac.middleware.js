const AppError = require('../shared/AppError');
const { COMPANY_WIDE_ROLES, permissionsForRole } = require('../shared/roles');

// Role hierarchy from the design (§4.1)
const ROLE_RANK = {
  super_admin:        100,
  company_admin:       80,
  branch_manager:      60,
  accountant:          50,
  inventory_manager:   40,
  cashier:             20,
  sales_staff:         10,
};

// Middleware factory: require caller to have AT LEAST one of the given roles
const requireRole = (...roles) => (req, _res, next) => {
  const userRole = req.user?.role;
  if (!userRole) throw AppError.unauthorized('Not authenticated');

  const allowed = roles.some(
    (r) => (ROLE_RANK[userRole] || 0) >= (ROLE_RANK[r] || 0)
  );

  if (!allowed)
    throw AppError.forbidden(
      `Role '${userRole}' is not permitted. Required: ${roles.join(' | ')}`
    );
  next();
};

// Middleware factory: require caller to have a specific permission code.
// Permissions are derived from the user's role via the canonical ROLE_PERMISSIONS
// map — they are no longer embedded in the JWT, keeping token size constant.
const requirePermission = (permissionCode) => (req, _res, next) => {
  if (req.user?.role === 'super_admin') return next();

  const perms = permissionsForRole(req.user?.role);
  if (!perms.includes(permissionCode))
    throw AppError.forbidden(`Missing permission: ${permissionCode}`);
  next();
};

const requireAnyPermission = (...permissionCodes) => (req, _res, next) => {
  if (req.user?.role === 'super_admin') return next();

  const perms = permissionsForRole(req.user?.role);
  if (!permissionCodes.some((code) => perms.includes(code)))
    throw AppError.forbidden(`Missing permission: ${permissionCodes.join(' | ')}`);
  next();
};

// Guard: ensure the requested branch belongs to the caller's company
// and the caller is assigned to that branch (unless they have all-branch access)
const requireBranchAccess = (branchIdParam = 'branchId') => (req, _res, next) => {
  const { role, branchIds = [], companyId } = req.user;
  const targetBranch = req.params[branchIdParam] || req.body[branchIdParam];

  // Company-wide roles bypass branch restriction
  if (COMPANY_WIDE_ROLES.includes(role)) return next();

  if (targetBranch && !branchIds.includes(targetBranch))
    throw AppError.forbidden('You do not have access to this branch');

  next();
};

// Guard: Finance module — requires has_finance flag in JWT planFeatures
const requireFinance = (req, _res, next) => {
  if (req.user?.role === 'super_admin') return next();
  if (!req.user?.planFeatures?.hasFinance)
    throw AppError.forbidden('Finance module requires Growth plan or higher', 'FINANCE_REQUIRED');
  next();
};

module.exports = { requireRole, requirePermission, requireAnyPermission, requireBranchAccess, requireFinance, ROLE_RANK };
