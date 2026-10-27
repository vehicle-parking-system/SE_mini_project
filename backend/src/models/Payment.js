const mongoose = require("mongoose");

const PAYMENT_METHODS = ["ONLINE", "AT_GATE"];
const TRANSACTION_TYPES = ["PAYMENT", "REFUND"];
// PAYMENT: PENDING until the gateway's signed webhook makes it CONFIRMED or FAILED.
// REFUND: PROCESSED once the gateway has accepted it.
const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "FAILED", "PROCESSED"];

// A money movement through the payment gateway: a payment for a parking session or a booking,
// or a refund of one. This collection is the transaction log (VPS-F-032).
//
// PCI scope (VPS-SR-004): card details never reach this system. The browser checkout or the
// card terminal hands them to the gateway, which gives back a single-use token; the token is
// passed to the gateway once and discarded, and only the gateway's own reference (gatewayRef)
// is stored. Requests that carry card data are refused before any route runs (middleware/cardData.js).
const paymentSchema = new mongoose.Schema({
  type: { type: String, enum: TRANSACTION_TYPES, default: "PAYMENT" },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", index: true },
  reservation: { type: mongoose.Schema.Types.ObjectId, ref: "Reservation", index: true },
  refundOf: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" }, // REFUND: the payment refunded
  facility: { type: mongoose.Schema.Types.ObjectId, ref: "Facility", required: true },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  amount: { type: Number, required: true, min: 0 }, // ₹
  status: { type: String, enum: PAYMENT_STATUSES, default: "PENDING" },
  gatewayRef: { type: String, required: true },
  // PAYMENT for a session: the moment its fee was calculated; leaving soon after costs no more
  quotedAt: { type: Date, required: true },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  confirmedAt: { type: Date },
  refundedAt: { type: Date }, // PAYMENT: when it was refunded
}, { timestamps: true });

paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ facility: 1, confirmedAt: 1 }); // revenue reports

paymentSchema.methods.toPublic = function toPublic() {
  return { paymentId: this.id, type: this.type, sessionId: this.session?.toString() ?? null,
    reservationId: this.reservation?.toString() ?? null, refundOf: this.refundOf?.toString() ?? null,
    method: this.method, amount: this.amount, status: this.status, gatewayRef: this.gatewayRef,
    createdAt: this.createdAt?.toISOString() ?? null, confirmedAt: this.confirmedAt?.toISOString() ?? null,
    refundedAt: this.refundedAt?.toISOString() ?? null };
};

module.exports = mongoose.model("Payment", paymentSchema, "payments");
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
