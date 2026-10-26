// Auth & Access Control: password hashing, JWTs, login with account lockout.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("./config");
const clock = require("./clock");
const logger = require("./logger");
const User = require("./models/User");
const AuditLog = require("./models/AuditLog");
const { notify } = require("./notifications");
const { reserveAttempt, refundAttempt } = require("./loginThrottle");
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

// "15 minutes", "1 hour", "24 hours" (rounded up)
function formatWait(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function lockedError(lockedUntil) {
  const wait = lockedUntil ? ` — try again in ${formatWait(lockedUntil - clock.now())}` : ". Please try again later";
  const err = locked(`Too many failed login attempts. Your account is locked${wait}.`);
  err.details = { lockedUntil };
  return err;
}

const audit = (event, actorId, details) => AuditLog.create({ event, actorId, at: clock.now(), details });

async function notifyAdmins(type, data) {
  const admins = await User.find({ role: "ADMIN" }, "email");
  for (const admin of admins) await notify({ userId: admin.id, to: admin.email, type, data });
}

// Length of the nth lock in a row: the schedule's nth entry, or its last one.
const lockMinutes = (n) => config.lockScheduleMinutes[Math.min(n, config.lockScheduleMinutes.length) - 1];

// VPS-SR-005: lock the account (longer each time it is locked again without a successful
// login in between), write an ACCOUNT_LOCKED audit entry, raise an alert in the log, and
// tell the account owner and the admins.
async function lockAccount(user, { ip }) {
  const lockNumber = user.lockCount + 1;
  const minutes = lockMinutes(lockNumber);
  const lockedUntil = new Date(clock.now().getTime() + minutes * 60000);
  await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockedUntil, lockCount: lockNumber });
  await audit("ACCOUNT_LOCKED", user._id, { failedAttempts: config.maxFailedLogins, lockNumber, minutes, lockedUntil, ip });
  logger.warn("ALERT account locked after repeated failed logins", { userId: user.id, lockNumber, lockedUntil });
  await notify({ userId: user.id, to: user.email, type: "ACCOUNT_LOCKED", data: { lockedUntil } });
  await notifyAdmins("ADMIN_ACCOUNT_LOCKED", { userId: user.id, email: user.email, lockNumber, lockedUntil, ip });
}

// Called once per IP and window, when the IP is first refused for too many failed logins.
async function onIpThrottled(ip, until) {
  await audit("LOGIN_RATE_LIMITED", null, { ip, until, limit: config.loginIpMaxFailures });
  logger.warn("ALERT login attempts throttled for an IP", { until });
  await notifyAdmins("ADMIN_LOGIN_RATE_LIMITED", { ip, until });
}

// Login with brute-force protection (VPS-SR-005).
//
// 1. The client's IP reserves one of its loginIpMaxFailures attempts for this time
//    window (loginThrottle.js), so one client can't try passwords across many accounts.
// 2. The attempt then *reserves* one of the account's maxFailedLogins attempts with a
//    single atomic update, and only then is the password checked. However many guesses
//    are sent in parallel, at most maxFailedLogins passwords are ever checked before the
//    account locks; the request that uses the last attempt is the one that locks it.
// A successful login gives both reservations back.
async function login({ email, password }, { ip } = {}) {
  const now = clock.now();
  const ipSlot = await reserveAttempt(ip, now, onIpThrottled);

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
      throw lockedError(existing.lockedUntil > now ? existing.lockedUntil : null);
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

  await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockedUntil: null, lockCount: 0, lastLoginAt: now });
  await refundAttempt(ipSlot);
  logger.info("login", { userId: user.id, role: user.role });
  return { token: signToken(user), user: user.toPublic() };
}

// Admin action: clear a lock (and the failure and lock counts) before it expires.
async function unlockAccount(userId, adminId) {
  const user = await User.findOneAndUpdate(
    { _id: userId, $or: [lockActive(clock.now()), { failedLoginAttempts: { $gt: 0 } }] },
    { failedLoginAttempts: 0, lockedUntil: null, lockCount: 0 },
  );
  if (user) await audit("ACCOUNT_UNLOCKED", adminId, { userId: user.id });
  return Boolean(user);
}

module.exports = { hashPassword, signToken, verifyToken, login, unlockAccount, lockActive, comparePassword: bcrypt.compare };
