const mongoose = require("mongoose");

const GATE_TYPES = ["ENTRY", "EXIT"];

// A barrier at a facility. The Hardware Abstraction Service drives it by id (hardware.js).
const gateSchema = new mongoose.Schema({
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true, index: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: GATE_TYPES, required: true },
});

gateSchema.methods.toPublic = function toPublic() {
  return { id: this.id, name: this.name, type: this.type };
};

module.exports = mongoose.model("Gate", gateSchema, "gates");
module.exports.GATE_TYPES = GATE_TYPES;
