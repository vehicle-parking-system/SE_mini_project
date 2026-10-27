// Vehicle exit (VPS-F-010 to VPS-F-013). At an exit gate the vehicle is identified by its
// session, entry ticket or plate, and the fee for its stay is calculated from the rate kept
// on its session. Until the fee is paid the barrier stays closed: 402 with the amount due.
const clock = require("./clock");
const hardware = require("./hardware");
const logger = require("./logger");
const qr = require("./qr");
const Gate = require("./models/Gate");
const Session = require("./models/Session");
const pricing = require("./pricing");
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

  const quote = pricing.quote(session, clock.now());
  hardware.display(gate.id, `Please pay ₹${quote.amount}`);
  logger.info("exit: payment required", { sessionId: session.id, gateId: gate.id, amount: quote.amount });
  throw paymentRequired(`Payment of ₹${quote.amount} is required before the barrier opens`,
    { sessionId: session.id, ...quote, paid: 0, paymentStatus: "PENDING" });
}

module.exports = { processExit, findSession };
