const mongoose = require("mongoose");

const ROLES = ["DRIVER", "ATTENDANT", "ADMIN"];

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String },
  // VPS-SR-002: bcrypt hash only; the plaintext password is never stored
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ROLES, default: "DRIVER" },
}, { timestamps: true });

userSchema.methods.toPublic = function toPublic() {
  return { id: this.id, name: this.name, email: this.email, phone: this.phone ?? null, role: this.role,
    createdAt: this.createdAt };
};

module.exports = mongoose.model("User", userSchema, "users");
module.exports.ROLES = ROLES;
