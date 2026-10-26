// Payments (VPS-F-011, VPS-F-030 to VPS-F-032). An attendant takes payment for a parking
// session at the gate; a driver pays online for their own session or booking. Everything goes
// through the payment gateway (paymentGateway.js) with a gateway token — card details never
// reach this service (VPS-SR-004). A payment counts only once the gateway confirms it with a
// signed webhook: the exit barrier opens when confirmed payments cover the fee (exit.js), and
// a paid booking becomes CONFIRMED. Every payment and refund is kept as a transaction (VPS-F-032).
const mongoose = require("mongoose");
const clock = require("./clock");
const config = require("./config");
const gateway = require("./paymentGateway");
const logger = require("./logger");
const Payment = require("./models/Payment");
const Reservation = require("./models/Reservation");
const Session = require("./models/Session");
const User = require("./models/User");
const Vehicle = require("./models/Vehicle");
const pricing = require("./pricing");
const { notify } = require("./notifications");
const { isId } = require("./slotSearch");
const { badRequest, conflict, notFound, unauthorized } = require("./errors");

const { PAYMENT_METHODS } = Payment;
const GATEWAY_TOKEN_RE = /^tok_[A-Za-z0-9_]{1,64}$/;

// Body -> {sessionId | reservationId, method, gatewayToken}, or a 400 listing every bad field.
function parsePayment(body = {}) {
  const errors = {};
  const targets = ["sessionId", "reservationId"].filter((f) => body[f] !== undefined && body[f] !== "");
  if (targets.length !== 1 || !isId(body[targets[0]])) errors.sessionId = "Choose the parking session or booking to pay for";
  if (!PAYMENT_METHODS.includes(body.method)) errors.method = `Method must be one of ${PAYMENT_METHODS.join(", ")}`;
  if (typeof body.gatewayToken !== "string" || !GATEWAY_TOKEN_RE.test(body.gatewayToken)) {
    errors.gatewayToken = "A payment gateway token (tok_...) is required";
  }
  if (Object.keys(errors).length) throw badRequest("Some payment fields are invalid", errors);
  return { sessionId: body.sessionId, reservationId: body.reservationId, method: body.method, gatewayToken: body.gatewayToken };
}

// What a session owes if it leaves at `now`, given the PENDING and CONFIRMED payments for it
// and for the booking it came in on (paid in advance). After a payment at the gate or online
// the fee is held at the moment that payment was quoted for exitGraceMinutes, so a driver who
// pays and drives to the barrier isn't asked for the next hour on the way out.
// -> {quote, total, paid, due, pending: [payments awaiting confirmation]}
function balanceOf(session, payments, now) {
  const confirmed = payments.filter((p) => p.status === "CONFIRMED");
  const paid = confirmed.reduce((sum, p) => sum + p.amount, 0);
  const lastQuoted = Math.max(0, ...confirmed.filter((p) => p.session).map((p) => p.quotedAt.getTime()));
  const billedAt = lastQuoted && now.getTime() - lastQuoted <= config.exitGraceMinutes * 60000 ? new Date(lastQuoted) : now;
  const quote = pricing.quote(session, billedAt);
  return { quote, total: quote.amount, paid, due: Math.max(0, quote.amount - paid),
    pending: payments.filter((p) => p.status === "PENDING") };
}

const belongsTo = (payment, session) => payment.session?.equals(session._id)
  || Boolean(session.reservation && payment.reservation?.equals(session.reservation));

const openPayments = (sessions) => Payment.find({
  type: "PAYMENT", status: { $in: ["PENDING", "CONFIRMED"] },
  $or: [{ session: { $in: sessions.map((s) => s._id) } }, { reservation: { $in: sessions.map((s) => s.reservation).filter(Boolean) } }],
});

async function balance(session, now = clock.now()) {
  return balanceOf(session, await openPayments([session]), now);
}

// The `fee` shown on parked sessions: the quote so far, what is paid and what is still due.
// One query for any number of sessions.
async function feesFor(sessions, now = clock.now()) {
  const payments = await openPayments(sessions);
  return Object.fromEntries(sessions.map((s) => {
    const { quote, total, paid, due, pending } = balanceOf(s, payments.filter((p) => belongsTo(p, s)), now);
    return [s.id, { ...quote, amount: due, total, paid, paymentStatus: due === 0 ? "PAID" : pending.length ? "PENDING" : "UNPAID" }];
  }));
}

// The price of a booking: its whole window at the rate for its slot's zone and vehicle type.
async function bookingPrice(reservation) {
  const vehicle = await Vehicle.findById(reservation.vehicle, "vehicleType");
  const rate = vehicle ? await pricing.rateFor(reservation.facility, reservation.zone, vehicle.vehicleType) : null;
  return pricing.feeFor(pricing.durationMinutes(reservation.startTime, reservation.endTime), rate ?? 0);
}

// Charges `amount` with the gateway token and records the PENDING payment. Paying again while
// the same amount awaits the gateway returns that payment instead of charging twice.
async function charge({ target, facility, method, amount, quotedAt, token, user }) {
  const waiting = await Payment.findOne({ ...target, type: "PAYMENT", status: "PENDING", amount });
  if (waiting) return waiting.toPublic();
  const _id = new mongoose.Types.ObjectId();
  const { gatewayRef } = await gateway.createCharge({ paymentId: _id.toString(), amount, token });
  const payment = await Payment.create({ _id, ...target, facility, method, amount, gatewayRef, quotedAt, paidBy: user._id });
  logger.info("payment created", { paymentId: payment.id, ...Object.fromEntries(Object.entries(target).map(([k, v]) => [k, String(v)])),
    method, amount });
  return payment.toPublic();
}

// Drivers pay online for their own vehicle's session or booking; attendants take payment for
// sessions at the gate.
async function createPayment(user, body) {
  const input = parsePayment(body);
  const expected = user.role === "DRIVER" ? "ONLINE" : "AT_GATE";
  if (input.method !== expected) throw badRequest(`Use ${expected} payment`, { method: `Use ${expected}` });

  if (input.reservationId) {
    const reservation = user.role === "DRIVER" && await Reservation.findOne({ _id: input.reservationId, driver: user._id });
    if (!reservation) throw notFound("Reservation not found");
    if (reservation.status !== "HELD") throw conflict(`This booking is ${reservation.status.toLowerCase()} and can't be paid`);
    const amount = await bookingPrice(reservation);
    if (amount === 0) throw conflict("Nothing to pay for this booking");
    return charge({ target: { reservation: reservation._id }, facility: reservation.facility, method: input.method, amount,
      quotedAt: clock.now(), token: input.gatewayToken, user });
  }

  const session = await Session.findById(input.sessionId);
  const ownSession = session && (user.role !== "DRIVER" || session.driver?.equals(user._id));
  if (!ownSession) throw notFound("Session not found");
  if (session.status !== "ACTIVE") throw conflict("This vehicle has already left");
  const { quote, due } = await balance(session);
  if (due === 0) throw conflict("Nothing to pay: the fee is already covered");
  return charge({ target: { session: session._id }, facility: session.facility, method: input.method, amount: due,
    quotedAt: new Date(quote.quotedAt), token: input.gatewayToken, user });
}

// Refunds a confirmed payment in full, once: the refund is a transaction of its own.
async function refundPayment(payment, reason) {
  const claimed = await Payment.findOneAndUpdate({ _id: payment._id, type: "PAYMENT", status: "CONFIRMED", refundedAt: null },
    { refundedAt: clock.now() }, { new: true });
  if (!claimed) return null;
  const { gatewayRef } = await gateway.createRefund({ paymentId: claimed.id, paymentRef: claimed.gatewayRef, amount: claimed.amount });
  const refund = await Payment.create({ type: "REFUND", refundOf: claimed._id, reservation: claimed.reservation,
    session: claimed.session, facility: claimed.facility, method: claimed.method, amount: claimed.amount, status: "PROCESSED",
    gatewayRef, quotedAt: clock.now(), confirmedAt: clock.now() });
  logger.info("payment refunded", { paymentId: claimed.id, refundId: refund.id, reason });
  return refund;
}

// Refunds every confirmed payment for a booking -> the refunds made
async function refundBooking(reservation, reason) {
  const paid = await Payment.find({ reservation: reservation._id, type: "PAYMENT", status: "CONFIRMED", refundedAt: null });
  return (await Promise.all(paid.map((p) => refundPayment(p, reason)))).filter(Boolean);
}

// A confirmed booking payment confirms the booking and tells the driver. If the booking lapsed
// or was cancelled while the payment was on its way, the money goes straight back.
async function onBookingPaid(payment) {
  const reservation = await Reservation.findOneAndUpdate({ _id: payment.reservation, status: "HELD" }, { status: "CONFIRMED" }, { new: true });
  if (!reservation) {
    await refundPayment(payment, "BOOKING_NOT_HELD");
    return;
  }
  const driver = await User.findById(reservation.driver, "email");
  if (driver) {
    await notify({ userId: driver.id, to: driver.email, type: "BOOKING_CONFIRMED",
      data: { reservationId: reservation.id, amount: payment.amount, startTime: reservation.startTime } });
  }
}

// A gateway event {paymentId, status: CONFIRMED|FAILED}. Only a PENDING payment changes, so a
// replayed or duplicate event changes nothing.
async function handleGatewayEvent({ paymentId, status } = {}) {
  if (!isId(paymentId) || !["CONFIRMED", "FAILED"].includes(status)) {
    throw badRequest("Unknown payment event", { paymentId: "Required", status: "CONFIRMED or FAILED" });
  }
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, type: "PAYMENT", status: "PENDING" },
    { status, ...(status === "CONFIRMED" && { confirmedAt: clock.now() }) },
    { new: true },
  );
  if (!payment) {
    if (!(await Payment.exists({ _id: paymentId }))) throw notFound("Payment not found");
    logger.info("payment event ignored: already settled", { paymentId });
    return { paymentId, status: "IGNORED" };
  }
  logger.info("payment settled", { paymentId: payment.id, status });
  if (status === "CONFIRMED" && payment.reservation) await onBookingPaid(payment);
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

// GET /api/admin/transactions?type&from&to: the transaction log, newest first
async function listTransactions({ type, from, to } = {}) {
  const filter = {
    ...(["PAYMENT", "REFUND"].includes(type) && { type }),
    ...((from || to) && { createdAt: { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) } }),
  };
  if (Object.values(filter.createdAt ?? {}).some((d) => Number.isNaN(d.getTime()))) {
    throw badRequest("Invalid date range", { from: "Use an ISO 8601 date", to: "Use an ISO 8601 date" });
  }
  return (await Payment.find(filter).sort({ createdAt: -1 }).limit(500)).map((p) => p.toPublic());
}

module.exports = { createPayment, receiveWebhook, handleGatewayEvent, getPayment, balance, feesFor, bookingPrice,
  refundBooking, listTransactions };
