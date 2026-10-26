const mongoose = require("mongoose");

// A parking lot. Opening hours are local times ("HH:MM") in the facility's time zone.
const facilitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true },
  timezone: { type: String, default: "Asia/Kolkata" },
  openTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  closeTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  reservationGraceMinutes: { type: Number, default: 15 },
}, { timestamps: true });

facilitySchema.methods.toPublic = function toPublic(zones = [], gates) {
  return { id: this.id, name: this.name, address: this.address ?? null, timezone: this.timezone,
    openTime: this.openTime, closeTime: this.closeTime, zones: zones.map((z) => ({ id: z.id, name: z.name })),
    ...(gates && { gates: gates.map((g) => g.toPublic()) }) };
};

module.exports = mongoose.model("Facility", facilitySchema, "facilities");
