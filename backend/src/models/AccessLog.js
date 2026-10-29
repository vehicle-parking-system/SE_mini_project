const mongoose = require("mongoose");

// Audit & Logging Service: one entry per API request (VPS-NF-004 access log). Method, path, outcome
// and who made it; never bodies, query strings, headers or tokens (VPS-NF-003). Kept in the
// database for LOG_HOT_DAYS, then moved to the archive (archive.js).
const accessLogSchema = new mongoose.Schema({
  at: { type: Date, required: true, index: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  status: { type: Number, required: true },
  ms: { type: Number },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  role: { type: String },
  ip: { type: String },
}, { versionKey: false });

accessLogSchema.methods.toPublic = function toPublic() {
  return { id: this.id, at: this.at.toISOString(), method: this.method, path: this.path, status: this.status, ms: this.ms ?? null,
    userId: this.userId?.toString() ?? null, role: this.role ?? null, ip: this.ip ?? null };
};

module.exports = mongoose.model("AccessLog", accessLogSchema, "accesslogs");
