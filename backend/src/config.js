// All runtime settings come from the environment (see tests/README.md).
const isTest = process.env.NODE_ENV === "test";

function parseTrustProxy(value) {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

const config = {
  isTest,
  port: Number(process.env.PORT) || 4000,
  mongoUrl: process.env.MONGO_URL || "mongodb://localhost:27017/vps",
  jwtSecret: process.env.JWT_SECRET || (isTest || process.env.NODE_ENV !== "production" ? "dev_jwt_secret" : undefined),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  // VPS-SR-005: lock after this many consecutive failed logins
  maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS) || 5,
  lockMinutes: Number(process.env.LOCK_MINUTES) || 15,
  // Express "trust proxy" setting, so the client IP recorded for login attempts is right behind a load balancer
  // ("true", a hop count such as "1", or a comma-separated list of proxy addresses)
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};

if (!config.jwtSecret) throw new Error("JWT_SECRET must be set in production");

module.exports = config;
