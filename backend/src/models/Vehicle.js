const mongoose = require("mongoose");
const { VEHICLE_TYPES } = require("../validation");

const vehicleSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // normalized: upper case, no spaces or dashes; one registration per plate
  plateNumber: { type: String, required: true, unique: true },
  vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
}, { timestamps: true });

vehicleSchema.methods.toPublic = function toPublic() {
  return { id: this.id, plateNumber: this.plateNumber, vehicleType: this.vehicleType };
};

module.exports = mongoose.model("Vehicle", vehicleSchema, "vehicles");
