const mongoose = require("mongoose");

// An area inside a facility (e.g. "Zone A", "Basement 1").
const zoneSchema = new mongoose.Schema({
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
  name: { type: String, required: true, trim: true },
});

module.exports = mongoose.model("Zone", zoneSchema, "zones");
