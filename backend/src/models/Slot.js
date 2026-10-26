const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("../validation");

const SLOT_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "INACTIVE"];

// One parking space. `status` is its live state; future bookings are Reservations.
const slotSchema = new mongoose.Schema({
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  zone: { type: mongoose.Schema.Types.ObjectId, ref: "Zone", required: true },
  number: { type: String, required: true, trim: true },
  vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
  distance: { type: Number, default: 0 }, // metres from the entry gate; nearest is offered first
  status: { type: String, enum: SLOT_STATUSES, default: "AVAILABLE" },
  // Bumped by every booking or status change. A booking re-checks it after inserting its
  // reservation, so two requests can never both claim the slot (see reservations.js).
  version: { type: Number, default: 0 },
}, { timestamps: true });

slotSchema.index({ facility: 1, zone: 1, vehicleType: 1, distance: 1 });
slotSchema.index({ facility: 1, number: 1 }, { unique: true });

module.exports = mongoose.model("Slot", slotSchema, "slots");
module.exports.SLOT_STATUSES = SLOT_STATUSES;
