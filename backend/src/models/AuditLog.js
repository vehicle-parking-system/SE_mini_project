const mongoose = require("mongoose");

// Audit & Logging Service: security and override events (e.g. ACCOUNT_LOCKED).
const auditLogSchema = new mongoose.Schema({
  event: { type: String, required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  details: { type: mongoose.Schema.Types.Mixed },
  at: { type: Date, required: true },
});

auditLogSchema.methods.toPublic = function toPublic() {
  return { id: this.id, event: this.event, actorId: this.actorId?.toString() ?? null, details: this.details, at: this.at };
};

module.exports = mongoose.model("AuditLog", auditLogSchema, "auditlogs");
