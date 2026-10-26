const mongoose = require("mongoose");

const ROLES = ["DRIVER", "ATTENDANT", "ADMIN"];

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String },
  // VPS-SR-002: bcrypt hash only; the plaintext password is never stored
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ROLES, default: "DRIVER" },
  // VPS-SR-005: consecutive failed logins and the resulting lock
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastFailedLoginAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  // locks in a row without a successful login in between; picks the next lock's length
  lockCount: { type: Number, default: 0 },
}, { timestamps: true });

userSchema.methods.toPublic = function toPublic() {
  return { id: this.id, name: this.name, email: this.email, phone: this.phone ?? null, role: this.role,
    createdAt: this.createdAt };
};

// Admin view of an account's login security state
userSchema.methods.toSecurity = function toSecurity() {
  return { ...this.toPublic(), failedLoginAttempts: this.failedLoginAttempts, lockedUntil: this.lockedUntil, lockCount: this.lockCount,
    lastFailedLoginAt: this.lastFailedLoginAt, lastLoginAt: this.lastLoginAt };
};

module.exports = mongoose.model("User", userSchema, "users");
module.exports.ROLES = ROLES;
