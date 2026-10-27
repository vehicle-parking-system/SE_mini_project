// All runtime settings come from the environment (see tests/README.md).
const isTest = process.env.NODE_ENV === "test";

function parseTrustProxy(value) {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

// "15,60,1440" -> [15, 60, 1440]; null when unset or invalid
function parseMinutesList(value) {
  const list = (value || "").split(",").map((v) => Number(v.trim()));
  return value && list.every((n) => Number.isFinite(n) && n > 0) ? list : null;
}

const config = {
  isTest,
  port: Number(process.env.PORT) || 4000,
  mongoUrl: process.env.MONGO_URL || "mongodb://localhost:27017/vps",
  jwtSecret: process.env.JWT_SECRET || (isTest || process.env.NODE_ENV !== "production" ? "dev_jwt_secret" : undefined),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  // Payment gateway webhooks are signed with this (hex HMAC-SHA256 of the raw body)
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET
    || (isTest || process.env.NODE_ENV !== "production" ? "test_webhook_secret" : undefined),
  // The sandbox gateway confirms its own payments after a moment (see paymentGateway.js)
  paymentSandboxAutoConfirm: process.env.PAYMENT_SANDBOX_AUTOCONFIRM ? process.env.PAYMENT_SANDBOX_AUTOCONFIRM === "true" : !isTest,
  // After paying, a vehicle may leave within this many minutes without paying for the extra time
  exitGraceMinutes: Number(process.env.EXIT_GRACE_MINUTES) || 15,
  // Signs the QR codes on bookings and entry tickets; derived from JWT_SECRET unless set
  qrSecret: process.env.QR_SECRET,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  // VPS-SR-005: lock after this many consecutive failed logins
  maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS) || 5,
  // How long each successive lock lasts; repeat offenders get the later, longer entries
  // (the last one repeats). Reset by a successful login or an admin unlock.
  lockScheduleMinutes: parseMinutesList(process.env.LOCK_SCHEDULE_MINUTES) || [15, 60, 1440],
  // Per-IP limit on login attempts that don't succeed, across all accounts (credential stuffing)
  loginIpMaxFailures: Number(process.env.LOGIN_IP_MAX_FAILURES) || 20,
  loginIpWindowMinutes: Number(process.env.LOGIN_IP_WINDOW_MINUTES) || 15,
  // Express "trust proxy" setting, so the client IP recorded for login attempts is right behind a load balancer
  // ("true", a hop count such as "1", or a comma-separated list of proxy addresses)
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};

if (!config.jwtSecret) throw new Error("JWT_SECRET must be set in production");
if (!config.paymentWebhookSecret) throw new Error("PAYMENT_WEBHOOK_SECRET must be set in production");
config.qrSecret ||= require("crypto").createHmac("sha256", config.jwtSecret).update("vps-qr").digest("hex");

module.exports = config;
