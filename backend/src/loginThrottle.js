// Per-IP login throttling (VPS-SR-005). The per-account lock stops guessing one
// account's password; this stops one client from trying passwords across many
// accounts (credential stuffing).
//
// Every login attempt from an IP reserves one of loginIpMaxFailures slots in the
// current loginIpWindowMinutes window before anything else is checked; a successful
// login gives its slot back. So the limit counts attempts that didn't succeed, and
// it holds however many requests arrive in parallel.
const config = require("./config");
const LoginThrottle = require("./models/LoginThrottle");
const { tooManyRequests } = require("./errors");

const windowMs = () => config.loginIpWindowMinutes * 60000;

function windowFor(ip, now) {
  const n = Math.floor(now.getTime() / windowMs());
  return { key: `${ip}|${n}`, endsAt: new Date((n + 1) * windowMs()) };
}

// Reserves an attempt for this IP and returns its window key, or throws 429.
// onLimited(ip, endsAt) runs once per IP and window, when the IP is first refused.
async function reserveAttempt(ip, now, onLimited) {
  if (!ip) return null;
  const { key, endsAt } = windowFor(ip, now);

  // A duplicate-key error means the window's document exists with no slots left —
  // or that a parallel request created it first, so the upsert is tried once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await LoginThrottle.findOneAndUpdate(
        { _id: key, count: { $lt: config.loginIpMaxFailures } },
        { $inc: { count: 1 }, $setOnInsert: { ip, expiresAt: endsAt } },
        { upsert: true },
      );
      return key;
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }

  const first = await LoginThrottle.updateOne({ _id: key, alerted: { $ne: true } }, { $set: { alerted: true } });
  if (first.modifiedCount) await onLimited(ip, endsAt);
  const seconds = Math.max(1, Math.ceil((endsAt - now) / 1000));
  throw tooManyRequests("Too many failed login attempts from your network. Please wait and try again later.", seconds);
}

// Gives the slot back after a successful login.
async function refundAttempt(key) {
  if (key) await LoginThrottle.updateOne({ _id: key, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

module.exports = { reserveAttempt, refundAttempt };
