const mongoose = require("mongoose");

const RESERVATION_STATUSES = ["HELD", "CONFIRMED", "EXPIRED", "CANCELLED", "REFUNDED"];

// A booking of one slot for a time window. Slot search treats a slot as taken for any
// window that overlaps an *active* reservation (see activeReservationFilter). Creating
// reservations is the Online Slot Reservation story; this defines what search relies on.
const reservationSchema = new mongoose.Schema({
  slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", required: true },
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: RESERVATION_STATUSES, default: "HELD" },
  holdExpiresAt: { type: Date }, // a HELD reservation stops blocking the slot after this
}, { timestamps: true });

reservationSchema.index({ slot: 1, startTime: 1, endTime: 1 });

// Reservations that block their slot during [start, end): confirmed ones, and held ones
// whose hold hasn't expired, whose window overlaps the given one.
function activeReservationFilter(start, end, now) {
  return {
    startTime: { $lt: end },
    endTime: { $gt: start },
    $or: [{ status: "CONFIRMED" }, { status: "HELD", holdExpiresAt: { $gt: now } }],
  };
}

module.exports = mongoose.model("Reservation", reservationSchema, "reservations");
module.exports.RESERVATION_STATUSES = RESERVATION_STATUSES;
module.exports.activeReservationFilter = activeReservationFilter;
