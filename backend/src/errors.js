// Standardized API errors: {error: {code, message, details?}} with an HTTP status.
// `extra` fields are returned next to `error`, e.g. the amount due with a 402.
class ApiError extends Error {
  constructor(status, code, message, details, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.extra = extra;
  }
}

const badRequest = (message, details) => new ApiError(400, "VALIDATION_ERROR", message, details);
const unauthorized = (message = "Authentication required") => new ApiError(401, "UNAUTHORIZED", message);
const forbidden = (message = "You do not have permission to do this") => new ApiError(403, "FORBIDDEN", message);
const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
const conflict = (message) => new ApiError(409, "CONFLICT", message);
// 402 at an exit gate while the parking fee isn't paid; `quote` ({amount, duration, ...}) is returned with it
const paymentRequired = (message, quote) => new ApiError(402, "PAYMENT_REQUIRED", message, undefined, quote);
// 409 at an entry gate when no slot can be given to the vehicle (VPS-F-003)
const facilityFull = (message) => new ApiError(409, "FACILITY_FULL", message);
const locked = (message) => new ApiError(423, "ACCOUNT_LOCKED", message);
// 429 with a Retry-After header (seconds)
function tooManyRequests(message, retryAfterSeconds) {
  const err = new ApiError(429, "TOO_MANY_REQUESTS", message);
  err.headers = { "Retry-After": String(retryAfterSeconds) };
  return err;
}

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, facilityFull, paymentRequired, locked,
  tooManyRequests };
