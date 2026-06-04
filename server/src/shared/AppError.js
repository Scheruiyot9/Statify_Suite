class AppError extends Error {
  constructor(message, statusCode, code = null, data = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;         // machine-readable e.g. 'INVALID_CREDENTIALS'
    this.data = data;         // optional extra payload included in the JSON response
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code, data)    { return new AppError(message, 400, code, data); }
  static unauthorized(message, code)        { return new AppError(message, 401, code || 'UNAUTHORIZED'); }
  static forbidden(message, code)           { return new AppError(message, 403, code || 'FORBIDDEN'); }
  static notFound(resource)                 { return new AppError(`${resource} not found`, 404, 'NOT_FOUND'); }
  static conflict(message, code, data)      { return new AppError(message, 409, code || 'CONFLICT', data); }
  static unprocessable(message, code, data) { return new AppError(message, 422, code, data); }
  static internal(message)                  { return new AppError(message, 500, 'INTERNAL_ERROR'); }
}

module.exports = AppError;
