// Payments for parking sessions (VPS-F-011, VPS-F-030). An attendant takes payment at the
// gate, or the driver pays online, through the payment gateway (paymentGateway.js). A payment
// counts only once the gateway confirms it with a signed webhook; the exit barrier opens when
// confirmed payments cover the fee (exit.js).
const mongoose = require("mongoose");
const clock = require("./clock");
const config = require("./config");
const gateway = require("./paymentGateway");
const logger = require("./logger");
const Payment = require("./models/Payment");
const Session = require("./models/Session");
const pricing = require("./pricing");
const { isId } = require("./slotSearch");
const { badRequest, conflict, notFound, unauthorized } = require("./errors");

const { PAYMENT_METHODS } = Payment;
const GATEWAY_TOKEN_RE = /^tok_[A-Za-z0-9_]{1,64}$/;

// Body -> {sessionId, method, gatewayToken}, or a 400 listing every bad field.
function parsePayment(body = {}) {
  const errors = {};
  if (!isId(body.sessionId)) errors.sessionId = "Choose the parking session to pay for";
  if (!PAYMENT_METHODS.includes(body.method)) errors.method = `Method must be one of ${PAYMENT_METHODS.join(", ")}`;
  if (typeof body.gatewayToken !== "string" || !GATEWAY_TOKEN_RE.test(body.gatewayToken)) {
    errors.gatewayToken = "A payment gateway token (tok_...) is required";
  }
  if (Object.keys(errors).length) throw badRequest("Some payment fields are invalid", errors);
  return { sessionId: body.sessionId, method: body.method, gatewayToken: body.gatewayToken };
}

// What a session owes if it leaves at `now`, given its PENDING and CONFIRMED payments. After a
// payment the fee is held at the moment that payment was quoted for exitGraceMinutes, so a
// driver who pays and drives to the barrier isn't asked for the next hour on the way out.
// -> {quote, total, paid, due, pending: [payments awaiting confirmation]}
function balanceOf(session, payments, now) {
  const confirmed = payments.filter((p) => p.status === "CONFIRMED");
  const paid = confirmed.reduce((sum, p) => sum + p.amount, 0);
  const lastQuoted = Math.max(0, ...confirmed.map((p) => p.quotedAt.getTime()));
  const billedAt = lastQuoted && now.getTime() - lastQuoted <= config.exitGraceMinutes * 60000 ? new Date(lastQuoted) : now;
  const quote = pricing.quote(session, billedAt);
  return { quote, total: quote.amount, paid, due: Math.max(0, quote.amount - paid),
    pending: payments.filter((p) => p.status === "PENDING") };
}

const openPayments = (sessionIds) => Payment.find({ session: { $in: sessionIds }, status: { $in: ["PENDING", "CONFIRMED"] } });

async function balance(session, now = clock.now()) {
  return balanceOf(session, await openPayments([session._id]), now);
}

// The `fee` shown on parked sessions: the quote so far, what is paid and what is still due.
// One query for any number of sessions.
async function feesFor(sessions, now = clock.now()) {
  const payments = await openPayments(sessions.map((s) => s._id));
  return Object.fromEntries(sessions.map((s) => {
    const { quote, total, paid, due, pending } = balanceOf(s, payments.filter((p) => p.session.equals(s._id)), now);
    return [s.id, { ...quote, amount: due, total, paid, paymentStatus: due === 0 ? "PAID" : pending.length ? "PENDING" : "UNPAID" }];
  }));
}

// Drivers pay online for their own vehicle's session; attendants take payment at the gate.
async function createPayment(user, body) {
  const input = parsePayment(body);
  const session = await Session.findById(input.sessionId);
  const ownSession = session && (user.role !== "DRIVER" || session.driver?.equals(user._id));
  if (!ownSession) throw notFound("Session not found");
  if (session.status !== "ACTIVE") throw conflict("This vehicle has already left");
  const expected = user.role === "DRIVER" ? "ONLINE" : "AT_GATE";
  if (input.method !== expected) throw badRequest(`Use ${expected} payment`, { method: `Use ${expected}` });

  const { quote, due, pending } = await balance(session);
  if (due === 0) throw conflict("Nothing to pay: the fee is already covered");
  // paying again while the same amount awaits the gateway returns that payment instead of charging twice
  const waiting = pending.find((p) => p.amount === due);
  if (waiting) return waiting.toPublic();

  const _id = new mongoose.Types.ObjectId();
  const { gatewayRef } = await gateway.createCharge({ paymentId: _id.toString(), amount: due, token: input.gatewayToken });
  const payment = await Payment.create({ _id, session: session._id, facility: session.facility, method: input.method,
    amount: due, gatewayRef, quotedAt: new Date(quote.quotedAt), paidBy: user._id });
  logger.info("payment created", { paymentId: payment.id, sessionId: session.id, method: input.method, amount: due });
  return payment.toPublic();
}

// A gateway event {paymentId, status: CONFIRMED|FAILED}. Only a PENDING payment changes, so a
// replayed or duplicate event changes nothing.
async function handleGatewayEvent({ paymentId, status } = {}) {
  if (!isId(paymentId) || !["CONFIRMED", "FAILED"].includes(status)) {
    throw badRequest("Unknown payment event", { paymentId: "Required", status: "CONFIRMED or FAILED" });
  }
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: "PENDING" },
    { status, ...(status === "CONFIRMED" && { confirmedAt: clock.now() }) },
    { new: true },
  );
  if (!payment) {
    if (!(await Payment.exists({ _id: paymentId }))) throw notFound("Payment not found");
    logger.info("payment event ignored: already settled", { paymentId });
    return { paymentId, status: "IGNORED" };
  }
  logger.info("payment settled", { paymentId: payment.id, status });
  return payment.toPublic();
}
gateway.setEventHandler(handleGatewayEvent);

// POST /api/payments/webhook: only events signed with PAYMENT_WEBHOOK_SECRET are accepted.
async function receiveWebhook(rawBody, signature, body) {
  if (!gateway.verifySignature(rawBody, signature)) {
    logger.warn("payment webhook rejected: bad signature");
    throw unauthorized("Invalid webhook signature");
  }
  return handleGatewayEvent(body);
}

async function getPayment(user, id) {
  const payment = isId(id) && await Payment.findOne({ _id: id, ...(user.role === "DRIVER" && { paidBy: user._id }) });
  if (!payment) throw notFound("Payment not found");
  return payment.toPublic();
}

module.exports = { createPayment, receiveWebhook, handleGatewayEvent, getPayment, balance, feesFor };
