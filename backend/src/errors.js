// Standardized API errors: {error: {code, message, details?}} with an HTTP status.
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new ApiError(400, "VALIDATION_ERROR", message, details);
const unauthorized = (message = "Authentication required") => new ApiError(401, "UNAUTHORIZED", message);
const forbidden = (message = "You do not have permission to do this") => new ApiError(403, "FORBIDDEN", message);
const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
const conflict = (message) => new ApiError(409, "CONFLICT", message);
const locked = (message) => new ApiError(423, "ACCOUNT_LOCKED", message);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, locked };
