const { query } = require('../config/database');
const AppError  = require('../shared/AppError');

// Verify the tenant (company) exists and its subscription is active.
// Runs after authenticate + attachTenant on every protected route.
const verifyTenant = async (req, _res, next) => {
  const tenantId = req.tenantId;

  // Super admin operating without a tenant context is fine
  if (req.user.role === 'super_admin' && !tenantId) return next();

  const { rows } = await query(
    `SELECT company_id, subscription_status, is_active
       FROM companies
      WHERE company_id = $1`,
    [tenantId]
  );

  if (!rows.length || !rows[0].is_active)
    throw AppError.forbidden('Company account not found or inactive', 'TENANT_INACTIVE');

  if (rows[0].subscription_status === 'suspended')
    throw AppError.forbidden('Subscription suspended. Please contact support.', 'SUBSCRIPTION_SUSPENDED');

  if (rows[0].subscription_status === 'cancelled')
    throw AppError.forbidden('Subscription cancelled.', 'SUBSCRIPTION_CANCELLED');

  // Attach verified company to request for downstream use
  req.company = rows[0];
  next();
};

// Enforce tenant data isolation: inject company_id into query params.
// Services should always call req.tenantScope() to get a safe WHERE clause.
const scopeTenant = (req, _res, next) => {
  req.tenantScope = () => ({ companyId: req.tenantId });
  next();
};

// Hard-fail when a tenant-scoped route is hit without a resolved tenantId.
// Super admins must pass the X-Company-ID header on these routes; all other
// roles get their companyId from the JWT automatically.
const requireTenantContext = (req, _res, next) => {
  if (!req.tenantId) {
    throw AppError.badRequest(
      'No company context. Super-admins must include the X-Company-ID header when accessing tenant-scoped routes.',
      'MISSING_TENANT_CONTEXT'
    );
  }
  next();
};

module.exports = { verifyTenant, scopeTenant, requireTenantContext };
