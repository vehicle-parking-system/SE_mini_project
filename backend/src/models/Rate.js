const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("../validation");

// Rate card: the hourly price for a vehicle type in one zone, or across the facility when
// `zone` is null. A zone's own rate wins over the facility-wide one (see pricing.js).
const rateSchema = new mongoose.Schema({
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  zone: { type: mongoose.Schema.Types.ObjectId, ref: "Zone", default: null },
  vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
  ratePerHour: { type: Number, required: true, min: 0 },
}, { timestamps: true });

rateSchema.index({ facility: 1, zone: 1, vehicleType: 1 }, { unique: true });

rateSchema.methods.toPublic = function toPublic() {
  return { id: this.id, facilityId: this.facility.toString(), zoneId: this.zone?.toString() ?? null,
    vehicleType: this.vehicleType, ratePerHour: this.ratePerHour, updatedAt: this.updatedAt };
};

module.exports = mongoose.model("Rate", rateSchema, "rates");
