const mongoose = require("mongoose");

// Audit & Logging Service: security, configuration and override events (e.g. ACCOUNT_LOCKED,
// MANUAL_OVERRIDE). actorEmail is kept on override entries so a shift log reads without a lookup.
const auditLogSchema = new mongoose.Schema({
  event: { type: String, required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actorEmail: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  at: { type: Date, required: true },
});

auditLogSchema.methods.toPublic = function toPublic() {
  return { id: this.id, event: this.event, actorId: this.actorId?.toString() ?? null,
    actorEmail: this.actorEmail ?? null, details: this.details, at: this.at };
};

module.exports = mongoose.model("AuditLog", auditLogSchema, "auditlogs");
