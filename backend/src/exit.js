// Vehicle exit (VPS-F-010 to VPS-F-013). At an exit gate the vehicle is identified by its
// session, entry ticket or plate, and the fee for its stay is calculated from the rate kept
// on its session. Payment verification (VPS-F-011): the barrier opens only once payments
// confirmed by the gateway cover the fee; until then, 402 with the amount still due.
const clock = require("./clock");
const hardware = require("./hardware");
const logger = require("./logger");
const qr = require("./qr");
const Gate = require("./models/Gate");
const Session = require("./models/Session");
const payments = require("./payments");
const { isId } = require("./slotSearch");
const { PLATE_RE, normalizePlate } = require("./validation");
const { badRequest, conflict, notFound, paymentRequired } = require("./errors");

// Body -> {gateId, sessionId | qrCode | plateNumber}, or a 400 listing every bad field.
function parseExit(body = {}) {
  const errors = {};
  if (!isId(body.gateId)) errors.gateId = "Choose an exit gate";
  const given = ["sessionId", "qrCode", "plateNumber"].filter((f) => body[f] !== undefined && body[f] !== "");
  if (given.length !== 1) errors.sessionId = "Scan the ticket, or give the session or number plate";
  else if (given[0] === "plateNumber" && !PLATE_RE.test(normalizePlate(body.plateNumber))) {
    errors.plateNumber = "Enter a valid number plate, e.g. KA01AB1234";
  }
  if (Object.keys(errors).length) throw badRequest("Some exit fields are invalid", errors);
  return { gateId: body.gateId, sessionId: body.sessionId, qrCode: body.qrCode,
    plateNumber: body.plateNumber && normalizePlate(body.plateNumber) };
}

// The session being exited; 404 if there is none
async function findSession({ sessionId, qrCode, plateNumber }) {
  let session = null;
  if (sessionId) session = isId(sessionId) ? await Session.findById(sessionId) : null;
  else if (qrCode) {
    const id = qr.readTicketCode(qrCode);
    if (!id) throw badRequest("Invalid ticket", { qrCode: "This QR code isn't a valid entry ticket" });
    session = isId(id) ? await Session.findById(id) : null;
  } else {
    session = await Session.findOne({ plateNumber, status: "ACTIVE" });
  }
  if (!session) throw notFound("Session not found");
  return session;
}

async function processExit(user, body) {
  const input = parseExit(body);
  const gate = await Gate.findById(input.gateId);
  if (!gate || gate.type !== "EXIT") throw notFound("Exit gate not found");
  const session = await findSession(input);
  if (session.status !== "ACTIVE") throw conflict("This vehicle has already left");
  if (!session.facility.equals(gate.facility)) throw conflict("This vehicle is parked at another facility");

  const now = clock.now();
  const { quote, total, paid, due, pending } = await payments.balance(session, now);
  if (due > 0) {
    // PENDING: a payment is waiting for the gateway's confirmation; UNPAID: nothing has been paid for it
    const paymentStatus = pending.length ? "PENDING" : "UNPAID";
    hardware.display(gate.id, paymentStatus === "PENDING" ? "Waiting for payment confirmation" : `Please pay ₹${due}`);
    logger.info("exit: payment required", { sessionId: session.id, gateId: gate.id, due, paymentStatus });
    throw paymentRequired(`Payment of ₹${due} is required before the barrier opens`,
      { sessionId: session.id, ...quote, amount: due, total, paid, paymentStatus });
  }

  // Paid: close the session (once, however many exit requests race) and open the barrier.
  const closed = await Session.findOneAndUpdate(
    { _id: session._id, status: "ACTIVE" },
    { status: "CLOSED", exitTime: now, exitGate: gate._id, duration: quote.duration, amount: total, paid },
    { new: true },
  );
  if (!closed) throw conflict("This vehicle has already left");
  hardware.display(gate.id, "Thank you. Drive safely");
  hardware.openBarrier(gate.id);
  logger.info("vehicle exited", { sessionId: closed.id, gateId: gate.id, amount: total });
  return { sessionId: closed.id, plateNumber: closed.plateNumber, entryTime: closed.entryTime.toISOString(),
    exitTime: now.toISOString(), duration: quote.duration, chargedHours: quote.chargedHours, ratePerHour: quote.ratePerHour,
    amount: total, paid, paymentStatus: total === 0 ? "NOT_REQUIRED" : "CONFIRMED" };
}

module.exports = { processExit, findSession };
