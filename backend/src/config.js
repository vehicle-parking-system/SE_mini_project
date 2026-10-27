// All runtime settings come from the environment (see tests/README.md).
const { mongoUrlProblem } = require("./transport");

const isTest = process.env.NODE_ENV === "test";
const isProduction = process.env.NODE_ENV === "production";

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

const certFile = process.env.TLS_CERT_FILE || null;

const config = {
  isTest,
  isProduction,
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
  // VPS-NF-004: access and audit logs stay in the database this many days, then move to compressed,
  // checksummed files under ARCHIVE_DIR, which are kept for LOG_RETENTION_DAYS (at least a year).
  logHotDays: Number(process.env.LOG_HOT_DAYS) || 90,
  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS) || 400,
  archiveDir: require("path").resolve(process.env.ARCHIVE_DIR || "archive"),
  // VPS-SR-001: TLS 1.2+ (see transport.js). Either the API terminates TLS with these files, or a
  // load balancer does (TLS_TERMINATED_BY_PROXY=true) and plain-HTTP requests are redirected or refused.
  https: {
    certFile,
    keyFile: process.env.TLS_KEY_FILE || null,
    caFile: process.env.TLS_CA_FILE || null, //          intermediate certificates, if any
    redirectPort: process.env.HTTP_REDIRECT_PORT ? Number(process.env.HTTP_REDIRECT_PORT) : null,
    terminatedByProxy: process.env.TLS_TERMINATED_BY_PROXY === "true",
    enforce: Boolean(certFile) || process.env.TLS_TERMINATED_BY_PROXY === "true",
    hstsMaxAgeSeconds: Number(process.env.HSTS_MAX_AGE_SECONDS) || 31536000,
  },
};

if (!config.jwtSecret) throw new Error("JWT_SECRET must be set in production");
if (!config.paymentWebhookSecret) throw new Error("PAYMENT_WEBHOOK_SECRET must be set in production");
if (config.logRetentionDays < 365) throw new Error("LOG_RETENTION_DAYS must be at least 365: logs are kept for at least a year (VPS-NF-004)");
if (config.logHotDays >= config.logRetentionDays) throw new Error("LOG_HOT_DAYS must be less than LOG_RETENTION_DAYS");
if (Boolean(config.https.certFile) !== Boolean(config.https.keyFile)) throw new Error("Set both TLS_CERT_FILE and TLS_KEY_FILE");
if (config.https.terminatedByProxy && !config.trustProxy) {
  throw new Error("TLS_TERMINATED_BY_PROXY needs TRUST_PROXY, so the API can tell which requests arrived over HTTPS");
}
if (isProduction && !config.https.enforce) {
  throw new Error("TLS is required in production: set TLS_CERT_FILE and TLS_KEY_FILE, or TLS_TERMINATED_BY_PROXY=true behind a TLS load balancer");
}
if (isProduction && mongoUrlProblem(config.mongoUrl)) throw new Error(mongoUrlProblem(config.mongoUrl));
config.qrSecret ||= require("crypto").createHmac("sha256", config.jwtSecret).update("vps-qr").digest("hex");

module.exports = config;
