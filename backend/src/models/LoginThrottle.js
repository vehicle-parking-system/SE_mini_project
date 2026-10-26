const mongoose = require("mongoose");

// Per-IP count of login attempts in one fixed time window ("<ip>|<window number>").
// Kept in MongoDB rather than memory so the limit holds across server instances;
// MongoDB deletes each document once its window is over (TTL index on expiresAt).
const loginThrottleSchema = new mongoose.Schema({
  _id: { type: String },
  ip: { type: String, required: true },
  count: { type: Number, default: 0 },
  alerted: { type: Boolean, default: false }, // admins already told this IP was throttled
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

module.exports = mongoose.model("LoginThrottle", loginThrottleSchema, "loginthrottles");
