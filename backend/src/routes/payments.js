// Payment processing (VPS-F-011, VPS-F-030). See permissions.js: drivers pay online for their
// own sessions, attendants take payment at the gate, and the webhook is authenticated by its signature.
const express = require("express");
const payments = require("../payments");

const router = express.Router();

// POST /api/payments {sessionId, method: ONLINE|AT_GATE, gatewayToken} -> 201 {paymentId, status: PENDING, amount, ...}
// The amount is what the session owes now. 409 if nothing is owed or the vehicle has left.
router.post("/", async (req, res) => {
  res.status(201).json(await payments.createPayment(req.user, req.body));
});

// POST /api/payments/webhook {paymentId, status: CONFIRMED|FAILED} signed with x-razorpay-signature
// -> 200; 401 for a bad signature (nothing changes); a replayed event is ignored
router.post("/webhook", async (req, res) => {
  res.json(await payments.receiveWebhook(req.rawBody, req.get("x-razorpay-signature"), req.body));
});

// GET /api/payments/:id -> {paymentId, status, amount, ...}; drivers see only their own
router.get("/:id", async (req, res) => {
  res.json(await payments.getPayment(req.user, req.params.id));
});

module.exports = router;
