const mongoose = require("mongoose");

const RESERVATION_STATUSES = ["HELD", "CONFIRMED", "CHECKED_IN", "COMPLETED", "EXPIRED", "CANCELLED", "REFUNDED"];

// A booking of one slot for a time window. Slot search and booking treat a slot as taken
// for any window that overlaps an *active* reservation (see activeReservationFilter).
//
// HELD: booked, not paid. The slot is kept until holdExpiresAt (start + the facility's
// grace period); if the driver hasn't arrived by then the hold lapses and it becomes EXPIRED.
// CONFIRMED: paid. CHECKED_IN: the vehicle has entered (its session is `session`).
// COMPLETED: the vehicle has left; the slot is free again even if the window hasn't ended.
// CANCELLED / REFUNDED: cancelled by the driver or an admin.
const reservationSchema = new mongoose.Schema({
  slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", required: true },
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  zone: { type: mongoose.Schema.Types.ObjectId, ref: "Zone" },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: RESERVATION_STATUSES, default: "HELD" },
  holdExpiresAt: { type: Date }, // a HELD reservation stops blocking the slot after this
  cancelledAt: { type: Date },
  checkedInAt: { type: Date },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session" },
}, { timestamps: true });

reservationSchema.index({ slot: 1, startTime: 1, endTime: 1 });
reservationSchema.index({ status: 1, holdExpiresAt: 1 });
reservationSchema.index({ facility: 1, startTime: 1 }); // usage reports

// The API view. Pass the related documents to include their names.
reservationSchema.methods.toPublic = function toPublic({ slot, zone, facility, vehicle } = {}) {
  return {
    reservationId: this.id, status: this.status,
    startTime: this.startTime.toISOString(), endTime: this.endTime.toISOString(),
    holdExpiresAt: this.holdExpiresAt?.toISOString() ?? null,
    slotId: this.slot.toString(), slotNumber: slot?.number ?? null,
    zoneId: this.zone?.toString() ?? null, zoneName: zone?.name ?? null,
    facilityId: this.facility.toString(), facilityName: facility?.name ?? null, timezone: facility?.timezone ?? null,
    vehicleId: this.vehicle?.toString() ?? null, plateNumber: vehicle?.plateNumber ?? null, vehicleType: vehicle?.vehicleType ?? null,
    createdAt: this.createdAt?.toISOString() ?? null, cancelledAt: this.cancelledAt?.toISOString() ?? null,
    checkedInAt: this.checkedInAt?.toISOString() ?? null, sessionId: this.session?.toString() ?? null,
  };
};

// Reservations that block their slot during [start, end): confirmed and checked-in ones,
// and held ones whose hold hasn't expired, whose window overlaps the given one.
function activeReservationFilter(start, end, now) {
  return {
    startTime: { $lt: end },
    endTime: { $gt: start },
    $or: [{ status: { $in: ["CONFIRMED", "CHECKED_IN"] } }, { status: "HELD", holdExpiresAt: { $gt: now } }],
  };
}

module.exports = mongoose.model("Reservation", reservationSchema, "reservations");
module.exports.RESERVATION_STATUSES = RESERVATION_STATUSES;
module.exports.activeReservationFilter = activeReservationFilter;
