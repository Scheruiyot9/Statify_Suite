const jwt      = require('jsonwebtoken');
const env      = require('../config/env');
const AppError = require('../shared/AppError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const authenticate = (req, _res, next) => {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer '))
    throw AppError.unauthorized('No token provided');

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = payload;   // { userId, companyId, role, branchIds }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      throw AppError.unauthorized('Token expired', 'TOKEN_EXPIRED');
    throw AppError.unauthorized('Invalid token', 'INVALID_TOKEN');
  }
};

// Attach tenant context from the verified JWT.
// Super admins: may pass X-Company-ID header to act within a specific tenant,
// or omit it to operate at platform level (companyId will be null).
// All other roles must have a companyId in their JWT.
const attachTenant = (req, _res, next) => {
  if (req.user.role === 'super_admin' && req.headers['x-company-id']) {
    const id = req.headers['x-company-id'];
    if (typeof id !== 'string' || !UUID_RE.test(id))
      throw AppError.badRequest('Invalid X-Company-ID header');
    req.tenantId = id;
  } else {
    req.tenantId = req.user.companyId || null;
  }
  if (!req.tenantId && req.user.role !== 'super_admin')
    throw AppError.forbidden('Tenant context missing');
  next();
};

module.exports = { authenticate, attachTenant };
