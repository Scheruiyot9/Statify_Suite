const env      = require('../config/env');
const AppError = require('../shared/AppError');

const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

const errorHandler = (err, req, res, _next) => {
  // Operational errors (AppError): safe to expose message
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      code:    err.code,
      message: err.message,
      ...(err.data != null && { data: err.data }),
    });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      code:    'DUPLICATE_ENTRY',
      message: 'A record with that value already exists.',
    });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(422).json({
      success: false,
      code:    'REFERENCE_NOT_FOUND',
      message: 'Referenced record does not exist.',
    });
  }

  // JWT errors (should be caught in auth middleware, this is a fallback)
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Invalid token.' });
  }

  // Unknown / programmer errors — never expose internals in production
  console.error('Unhandled error:', err);
  return res.status(500).json({
    success: false,
    code:    'INTERNAL_ERROR',
    message: env.isDev ? err.message : 'Something went wrong. Please try again.',
    ...(env.isDev && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };
