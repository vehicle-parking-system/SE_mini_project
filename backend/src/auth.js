// Auth & Access Control: password hashing, JWTs, login with account lockout.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("./config");
const clock = require("./clock");
const logger = require("./logger");
const User = require("./models/User");
const AuditLog = require("./models/AuditLog");
const { notify } = require("./notifications");
const { unauthorized, locked } = require("./errors");

const hashPassword = (password) => bcrypt.hash(password, config.bcryptRounds);

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", config.bcryptRounds);

const signToken = (user) =>
  jwt.sign({ role: user.role }, config.jwtSecret, { subject: user.id, expiresIn: config.jwtExpiresIn, algorithm: "HS256" });

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    throw unauthorized("Your session has expired or is invalid. Please log in again.");
  }
}

const INVALID_CREDENTIALS = "Incorrect email or password";

const lockActive = (now) => ({ lockedUntil: { $gt: now } });
const lockInactive = (now) => ({ $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] });

function lockedError(lockedUntil) {
  const minutes = Math.max(1, Math.ceil((lockedUntil - clock.now()) / 60000));
  const err = locked(`Too many failed login attempts. Your account is locked — try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  err.details = { lockedUntil };
  return err;
}

const audit = (event, actorId, details) => AuditLog.create({ event, actorId, at: clock.now(), details });

// VPS-SR-005: lock the account for lockMinutes, write an ACCOUNT_LOCKED audit entry,
// raise an alert in the log and tell the account owner.
async function lockAccount(user, { ip }) {
  const lockedUntil = new Date(clock.now().getTime() + config.lockMinutes * 60000);
  await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockedUntil });
  await audit("ACCOUNT_LOCKED", user._id, { failedAttempts: config.maxFailedLogins, lockedUntil, ip });
  logger.warn("ALERT account locked after repeated failed logins", { userId: user.id, lockedUntil });
  await notify({ userId: user.id, to: user.email, type: "ACCOUNT_LOCKED", data: { lockedUntil } });
}

// Login with brute-force protection (VPS-SR-005).
//
// Each attempt first *reserves* one of the account's maxFailedLogins attempts with a
// single atomic update, and only then checks the password. However many guesses are
// sent in parallel, at most maxFailedLogins passwords are ever checked before the
// account locks; the request that uses the last attempt is the one that locks it.
async function login({ email, password }, { ip } = {}) {
  const now = clock.now();
  const user = await User.findOneAndUpdate(
    { email, ...lockInactive(now), failedLoginAttempts: { $lt: config.maxFailedLogins } },
    { $inc: { failedLoginAttempts: 1 } },
    { new: true },
  );

  if (!user) {
    const existing = await User.findOne({ email }, "lockedUntil");
    if (existing) {
      // locked, or its last attempt is being checked by a concurrent request
      await audit("LOGIN_BLOCKED", existing._id, { ip });
      throw lockedError(existing.lockedUntil > now ? existing.lockedUntil : new Date(now.getTime() + config.lockMinutes * 60000));
    }
    await bcrypt.compare(password, DUMMY_HASH); // same timing as a real check: don't reveal which emails exist
    await audit("LOGIN_FAILED", null, { reason: "UNKNOWN_EMAIL", ip });
    throw unauthorized(INVALID_CREDENTIALS);
  }

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await User.updateOne({ _id: user._id }, { lastFailedLoginAt: now });
    await audit("LOGIN_FAILED", user._id, { reason: "WRONG_PASSWORD", attempt: user.failedLoginAttempts, ip });
    if (user.failedLoginAttempts >= config.maxFailedLogins) await lockAccount(user, { ip });
    throw unauthorized(INVALID_CREDENTIALS);
  }

  await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now });
  logger.info("login", { userId: user.id, role: user.role });
  return { token: signToken(user), user: user.toPublic() };
}

// Admin action: clear a lock (and the failure count) before it expires.
async function unlockAccount(userId, adminId) {
  const user = await User.findOneAndUpdate(
    { _id: userId, $or: [lockActive(clock.now()), { failedLoginAttempts: { $gt: 0 } }] },
    { failedLoginAttempts: 0, lockedUntil: null },
  );
  if (user) await audit("ACCOUNT_UNLOCKED", adminId, { userId: user.id });
  return Boolean(user);
}

module.exports = { hashPassword, signToken, verifyToken, login, unlockAccount, lockActive, comparePassword: bcrypt.compare };
