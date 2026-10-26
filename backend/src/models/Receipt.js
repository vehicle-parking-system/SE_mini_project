const mongoose = require("mongoose");

// Exit receipt (VPS-F-013): an immutable record of one parking session's charge, issued once
// when the vehicle leaves. Payment lines carry the gateway's reference only.
const receiptSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true }, // VPS-2026-000001
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, unique: true },
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  facilityName: { type: String, required: true },
  plateNumber: { type: String, required: true },
  vehicleType: { type: String, required: true },
  slotNumber: { type: String },
  zoneName: { type: String },
  entryTime: { type: Date, required: true },
  exitTime: { type: Date, required: true },
  duration: { type: Number, required: true }, // billed minutes
  chargedHours: { type: Number, required: true },
  ratePerHour: { type: Number, required: true },
  amount: { type: Number, required: true }, // ₹ total charged
  payments: [{ _id: false, method: String, amount: Number, gatewayRef: String, confirmedAt: Date }],
  issuedAt: { type: Date, required: true },
});

receiptSchema.methods.toPublic = function toPublic(timezone) {
  return {
    receiptId: this.id, number: this.number, sessionId: this.session.toString(), facilityName: this.facilityName,
    timezone: timezone ?? null, plateNumber: this.plateNumber, vehicleType: this.vehicleType,
    slotNumber: this.slotNumber ?? null, zoneName: this.zoneName ?? null,
    entryTime: this.entryTime.toISOString(), exitTime: this.exitTime.toISOString(), duration: this.duration,
    chargedHours: this.chargedHours, ratePerHour: this.ratePerHour, amount: this.amount,
    payments: this.payments.map((p) => ({ method: p.method, amount: p.amount, gatewayRef: p.gatewayRef,
      confirmedAt: p.confirmedAt?.toISOString() ?? null })),
    issuedAt: this.issuedAt.toISOString(),
  };
};

module.exports = mongoose.model("Receipt", receiptSchema, "receipts");
