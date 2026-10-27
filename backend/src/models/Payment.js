const mongoose = require("mongoose");

const PAYMENT_METHODS = ["ONLINE", "AT_GATE"];
const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "FAILED"];

// A payment for a parking session. Only the payment gateway's reference is kept — never card
// details. PENDING until the gateway's signed webhook confirms (or fails) it.
const paymentSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", index: true },
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  amount: { type: Number, required: true, min: 0 }, // ₹
  status: { type: String, enum: PAYMENT_STATUSES, default: "PENDING" },
  gatewayRef: { type: String, required: true },
  // the moment the fee was calculated for this payment; leaving soon after it costs no more
  quotedAt: { type: Date, required: true },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  confirmedAt: { type: Date },
}, { timestamps: true });

paymentSchema.methods.toPublic = function toPublic() {
  return { paymentId: this.id, sessionId: this.session?.toString() ?? null, method: this.method, amount: this.amount,
    status: this.status, gatewayRef: this.gatewayRef, createdAt: this.createdAt?.toISOString() ?? null,
    confirmedAt: this.confirmedAt?.toISOString() ?? null };
};

module.exports = mongoose.model("Payment", paymentSchema, "payments");
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
