// Exit receipts (VPS-F-013): issued when a vehicle leaves, printed at the gate, sent to a
// registered driver, and kept in their parking history.
const clock = require("./clock");
const { findFacility, findZone } = require("./cache");
const logger = require("./logger");
const Counter = require("./models/Counter");
const Facility = require("./models/Facility");
const Payment = require("./models/Payment");
const Receipt = require("./models/Receipt");
const Slot = require("./models/Slot");
const User = require("./models/User");
const pricing = require("./pricing");
const { notify } = require("./notifications");
const { isId } = require("./slotSearch");
const { notFound } = require("./errors");

// Issues the receipt for a closed session; returns it. A session gets one receipt only.
async function issueReceipt(session) {
  const existing = await Receipt.findOne({ session: session._id });
  if (existing) return existing;

  const [facility, slot, zone, payments] = await Promise.all([
    findFacility(session.facility), Slot.findById(session.slot), findZone(session.zone),
    Payment.find({ session: session._id, status: "CONFIRMED" }).sort({ confirmedAt: 1 }),
  ]);
  const issuedAt = clock.now();
  const number = `VPS-${issuedAt.getUTCFullYear()}-${String(await Counter.next(`receipt-${issuedAt.getUTCFullYear()}`)).padStart(6, "0")}`;
  const receipt = await Receipt.create({
    number, session: session._id, facility: session.facility, driver: session.driver, facilityName: facility.name,
    plateNumber: session.plateNumber, vehicleType: session.vehicleType, slotNumber: slot?.number, zoneName: zone?.name,
    entryTime: session.entryTime, exitTime: session.exitTime, duration: session.duration,
    chargedHours: pricing.chargedHours(session.duration), ratePerHour: session.ratePerHour, amount: session.amount,
    payments: payments.map((p) => ({ method: p.method, amount: p.amount, gatewayRef: p.gatewayRef, confirmedAt: p.confirmedAt })),
    issuedAt,
  });
  logger.info("receipt issued", { receiptId: receipt.id, sessionId: session.id });

  // digital receipt for a registered driver
  const driver = session.driver && await User.findById(session.driver, "email");
  if (driver) {
    await notify({ userId: driver.id, to: driver.email, type: "EXIT_RECEIPT",
      data: { receiptId: receipt.id, number, amount: receipt.amount, duration: receipt.duration } });
  }
  return receipt;
}

const present = async (receipts) => {
  const facilities = await Facility.find({ _id: { $in: receipts.map((r) => r.facility) } }, "timezone");
  const tz = Object.fromEntries(facilities.map((f) => [f.id, f.timezone]));
  return receipts.map((r) => r.toPublic(tz[r.facility.toString()]));
};

// Staff can read any receipt; a driver only their own.
async function getReceipt(user, id) {
  const receipt = isId(id) && await Receipt.findOne({ _id: id, ...(user.role === "DRIVER" && { driver: user._id }) });
  if (!receipt) throw notFound("Receipt not found");
  return (await present([receipt]))[0];
}

async function receiptsForDriver(user) {
  return present(await Receipt.find({ driver: user._id }).sort({ exitTime: -1 }).limit(100));
}

module.exports = { issueReceipt, getReceipt, receiptsForDriver };
