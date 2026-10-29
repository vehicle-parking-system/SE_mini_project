// Gate monitoring and manual override (VPS-F-042). When a sensor, camera or barrier fails, an
// attendant opens or closes the barrier by hand from the kiosk. Every override, and every vehicle
// admitted on a typed-in plate instead of the ANPR camera or QR scanner, is audited as
// MANUAL_OVERRIDE with who did it, at which gate and why.
const clock = require("./clock");
const hardware = require("./hardware");
const logger = require("./logger");
const AuditLog = require("./models/AuditLog");
const Gate = require("./models/Gate");
const { isId } = require("./slotSearch");
const { badRequest, notFound } = require("./errors");

const OVERRIDE_ACTIONS = ["OPEN", "CLOSE"];
const OVERRIDE_REASONS = ["ANPR_FAILURE", "SCANNER_FAILURE", "BARRIER_FAULT", "PAYMENT_TERMINAL_FAILURE", "EMERGENCY", "OTHER"];

function auditOverride(user, details) {
  return AuditLog.create({ event: "MANUAL_OVERRIDE", actorId: user._id, actorEmail: user.email, at: clock.now(), details });
}

// POST /api/gates/:id/override {action: OPEN|CLOSE, reason, note?}
async function overrideGate(user, gateId, body = {}) {
  const errors = {};
  if (!OVERRIDE_ACTIONS.includes(body.action)) errors.action = "Action must be OPEN or CLOSE";
  if (!OVERRIDE_REASONS.includes(body.reason)) errors.reason = `Reason must be one of ${OVERRIDE_REASONS.join(", ")}`;
  if (body.note !== undefined && !(typeof body.note === "string" && body.note.length <= 200)) errors.note = "Note must be at most 200 characters";
  if (body.reason === "OTHER" && !(typeof body.note === "string" && body.note.trim().length >= 3)) errors.note = "Say what happened";
  if (Object.keys(errors).length) throw badRequest("Some override fields are invalid", errors);

  const gate = isId(gateId) && await Gate.findById(gateId);
  if (!gate) throw notFound("Gate not found");

  hardware.display(gate.id, body.action === "OPEN" ? "Barrier opened by attendant" : "Please wait");
  const delivered = body.action === "OPEN" ? hardware.openBarrier(gate.id) : hardware.closeBarrier(gate.id);
  const log = await auditOverride(user, { kind: "BARRIER", action: body.action, reason: body.reason, note: body.note?.trim() || undefined,
    gateId: gate.id, gateName: gate.name, facilityId: gate.facility.toString(), delivered });
  logger.warn("manual gate override", { gateId: gate.id, action: body.action, reason: body.reason, by: user.id, delivered });
  return { gateId: gate.id, action: body.action, delivered, ...hardware.status([gate.id])[gate.id], logId: log.id };
}

// A vehicle admitted on a plate the attendant typed in (the camera or scanner couldn't read it)
function auditManualEntry(user, gate, session) {
  return auditOverride(user, { kind: "MANUAL_ENTRY", gateId: gate.id, gateName: gate.name, facilityId: gate.facility.toString(),
    sessionId: session.id, plateNumber: session.plateNumber });
}

// GET /api/gates/status?facilityId -> every gate with its controller link
async function gateStatus({ facilityId } = {}) {
  const gates = await Gate.find(isId(facilityId) ? { facility: facilityId } : {}).sort({ type: 1, name: 1 });
  const links = hardware.status(gates.map((g) => g.id));
  return gates.map((g) => ({ ...g.toPublic(), facilityId: g.facility.toString(), ...links[g.id] }));
}

// GET /api/gates/overrides?facilityId -> the latest manual overrides, for the attendants' shift log
async function recentOverrides({ facilityId } = {}) {
  const logs = await AuditLog.find({ event: "MANUAL_OVERRIDE", ...(isId(facilityId) && { "details.facilityId": facilityId }) })
    .sort({ at: -1 }).limit(50);
  return logs.map((l) => l.toPublic());
}

module.exports = { overrideGate, auditManualEntry, gateStatus, recentOverrides, OVERRIDE_REASONS };
