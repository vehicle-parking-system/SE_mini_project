const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("../validation");

const ENTRY_SOURCES = ["ANPR", "QR", "MANUAL"];
const SESSION_STATUSES = ["ACTIVE", "CLOSED"];

// One vehicle's stay: from the entry gate to the exit gate. Walk-ins have no driver or
// reservation; a booked vehicle's session points at its reservation.
const sessionSchema = new mongoose.Schema({
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  zone: { type: mongoose.Schema.Types.ObjectId, ref: "Zone", required: true },
  slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", required: true },
  entryGate: { type: mongoose.Schema.Types.ObjectId, ref: "Gate", required: true },
  exitGate: { type: mongoose.Schema.Types.ObjectId, ref: "Gate" },
  // normalized like Vehicle.plateNumber; the registered vehicle and its owner when the plate is known
  plateNumber: { type: String, required: true },
  vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reservation: { type: mongoose.Schema.Types.ObjectId, ref: "Reservation" },
  source: { type: String, enum: ENTRY_SOURCES, required: true },
  capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // the attendant or kiosk account
  entryTime: { type: Date, required: true },
  exitTime: { type: Date },
  status: { type: String, enum: SESSION_STATUSES, default: "ACTIVE" },
}, { timestamps: true });

// A plate can be inside only once at a time, however many entry requests race
sessionSchema.index({ plateNumber: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });
sessionSchema.index({ facility: 1, status: 1, entryTime: -1 });

sessionSchema.methods.toPublic = function toPublic({ slot, zone, gate } = {}) {
  return {
    sessionId: this.id, status: this.status, plateNumber: this.plateNumber, vehicleType: this.vehicleType,
    source: this.source, facilityId: this.facility.toString(),
    gateId: this.entryGate.toString(), gateName: gate?.name ?? null, exitGateId: this.exitGate?.toString() ?? null,
    slotId: this.slot.toString(), slotNumber: slot?.number ?? null,
    zoneId: this.zone.toString(), zoneName: zone?.name ?? null,
    reservationId: this.reservation?.toString() ?? null,
    entryTime: this.entryTime.toISOString(), exitTime: this.exitTime?.toISOString() ?? null,
  };
};

module.exports = mongoose.model("Session", sessionSchema, "sessions");
module.exports.ENTRY_SOURCES = ENTRY_SOURCES;
module.exports.SESSION_STATUSES = SESSION_STATUSES;
