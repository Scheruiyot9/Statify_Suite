// Roles that can see all branches in a company without explicit branch assignment
const COMPANY_WIDE_ROLES = ['super_admin', 'company_admin', 'accountant'];

// Canonical permission set per role — single source of truth on the server.
// Mirrors the seeded role_permissions rows; eliminates the need to embed
// permission arrays in every JWT (keeps tokens small regardless of future additions).
const ROLE_PERMISSIONS = {
  super_admin:    ['view_products','manage_products','view_inventory','adjust_stock',
                   'view_customers','manage_customers','view_sales','process_refund',
                   'view_reports','manage_users','manage_settings','open_pos_session'],
  company_admin:  ['view_products','manage_products','view_inventory','adjust_stock',
                   'view_customers','manage_customers','view_sales','process_refund',
                   'view_reports','manage_users','manage_settings','open_pos_session'],
  branch_manager: ['view_products','view_inventory','adjust_stock',
                   'view_customers','manage_customers','view_sales','process_refund',
                   'open_pos_session'],
  // accountant now includes all inventory_manager permissions
  accountant:     ['view_products','manage_products','view_inventory','adjust_stock',
                   'view_customers','view_sales','process_refund','view_reports'],
  cashier:        ['view_products','view_customers','manage_customers',
                   'view_sales','process_refund','open_pos_session'],
};

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

const isCompanyWide = (role) => COMPANY_WIDE_ROLES.includes(role);

/**
 * Build a WHERE clause fragment + params array for branch scoping.
 * tableAlias is the SQL alias prefix for branch_id (default 'st').
 */
function branchScope(role, companyId, branchIds, tableAlias = 'st') {
  if (isCompanyWide(role)) {
    return { clause: '', params: [companyId] };
  }
  const ids = branchIds && branchIds.length
    ? branchIds
    : ['00000000-0000-0000-0000-000000000000'];
  return { clause: `AND ${tableAlias}.branch_id = ANY($2)`, params: [companyId, ids] };
}

/**
 * Resolve which branchId to use for a request, enforcing access control.
 * opts.from: array of sources to check in order (default: query then body)
 * opts.required: throw if not found (default true)
 */
function resolveBranchId(req, { from = ['query', 'body'], required = true } = {}) {
  let branchId;
  for (const source of from) {
    branchId = source === 'query' ? req.query?.branchId : req.body?.branchId;
    if (branchId) break;
  }
  if (!branchId) branchId = req.user.branchIds?.[0];

  if (!branchId) {
    if (required) {
      const AppError = require('./AppError');
      throw AppError.badRequest('branchId is required');
    }
    return null;
  }

  if (!isCompanyWide(req.user.role) && !req.user.branchIds?.includes(branchId)) {
    const AppError = require('./AppError');
    throw AppError.forbidden('You do not have access to this branch');
  }

  return branchId;
}

module.exports = { COMPANY_WIDE_ROLES, ROLE_PERMISSIONS, isCompanyWide, permissionsForRole, branchScope, resolveBranchId };
