// Online pre-booking (VPS-F-020, VPS-F-022, VPS-F-023): a driver books a slot for a time
// window. The window follows the same rules as search, the slot is the nearest free one
// (or one the driver picked from the search results), and it is claimed with atomic slot
// locking so two drivers can never book it for overlapping windows.
const clock = require("./clock");
const logger = require("./logger");
const qr = require("./qr");
const AuditLog = require("./models/AuditLog");
const Facility = require("./models/Facility");
const Reservation = require("./models/Reservation");
const Slot = require("./models/Slot");
const Vehicle = require("./models/Vehicle");
const Zone = require("./models/Zone");
const { notify } = require("./notifications");
const events = require("./events");
const { windowErrors, checkWindow, loadFacility, freeSlots, isId } = require("./slotSearch");
const { badRequest, conflict, notFound } = require("./errors");

const { activeReservationFilter } = Reservation;
const CANCELLABLE = ["HELD", "CONFIRMED"];
// How often one slot is re-checked when concurrent requests keep changing it
const MAX_CLAIM_ATTEMPTS = 5;

const optionalId = (v) => v === undefined || v === null || v === "" || isId(v);

// Body -> {vehicleId, facilityId, zoneId?, slotId?, start, end}, or a 400 listing every bad field.
function parseBooking(body = {}) {
  const errors = {};
  if (!isId(body.vehicleId)) errors.vehicleId = "Choose one of your vehicles";
  if (!isId(body.facilityId)) errors.facilityId = "Choose a facility";
  if (!optionalId(body.zoneId)) errors.zoneId = "Unknown zone";
  if (!optionalId(body.slotId)) errors.slotId = "Unknown slot";
  windowErrors(errors, body);
  if (Object.keys(errors).length) throw badRequest("Some booking fields are invalid", errors);
  return { vehicleId: body.vehicleId, facilityId: body.facilityId, zoneId: body.zoneId || null,
    slotId: body.slotId || null, start: new Date(body.startTime), end: new Date(body.endTime) };
}

// Atomic slot locking. Read the slot's version, check nothing overlaps, insert the
// reservation, then bump the version only if it is still the one read at the start.
// Anything that touched the slot in between (another booking, a vehicle parking in it,
// an admin deactivating it) bumped the version too, so the bump fails: the reservation is
// withdrawn and the slot checked again. Of any number of concurrent requests for
// overlapping windows, exactly one keeps its reservation.
// -> the reservation, or null if the slot isn't free for the window
async function claimSlot(slotId, doc, now) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const slot = await Slot.findById(slotId);
    if (!slot || ["INACTIVE", "OCCUPIED"].includes(slot.status)) return null;
    if (await Reservation.exists({ slot: slot._id, ...activeReservationFilter(doc.startTime, doc.endTime, now) })) return null;

    const reservation = await Reservation.create({ ...doc, slot: slot._id, zone: slot.zone });
    const bumped = await Slot.updateOne({ _id: slot._id, version: slot.version }, { $inc: { version: 1 } });
    if (bumped.modifiedCount) return reservation;
    await Reservation.deleteOne({ _id: reservation._id });
  }
  return null;
}

// HELD reservations whose driver didn't arrive within the grace period become EXPIRED.
// Search already ignores them; this makes their status say so too.
async function expireHolds(now = clock.now()) {
  const { modifiedCount } = await Reservation.updateMany(
    { status: "HELD", holdExpiresAt: { $lte: now } }, { status: "EXPIRED" });
  if (modifiedCount) logger.info("reservation holds expired", { count: modifiedCount });
}

// Reservations with their slot, zone, facility and vehicle, as the API returns them.
async function present(reservations) {
  const ids = (field) => [...new Set(reservations.map((r) => r[field]?.toString()).filter(Boolean))];
  const byId = (docs) => Object.fromEntries(docs.map((d) => [d.id, d]));
  const [slots, zones, facilities, vehicles] = await Promise.all([
    Slot.find({ _id: { $in: ids("slot") } }), Zone.find({ _id: { $in: ids("zone") } }),
    Facility.find({ _id: { $in: ids("facility") } }), Vehicle.find({ _id: { $in: ids("vehicle") } }),
  ].map((q) => q.then(byId)));
  return reservations.map((r) => ({
    ...r.toPublic({ slot: slots[r.slot], zone: zones[r.zone], facility: facilities[r.facility], vehicle: vehicles[r.vehicle] }),
    qrCode: CANCELLABLE.includes(r.status) ? qr.bookingCode(r.id) : null,
  }));
}
const presentOne = async (r) => (await present([r]))[0];

async function createReservation(user, body) {
  const input = parseBooking(body);
  const vehicle = await Vehicle.findOne({ _id: input.vehicleId, owner: user._id });
  if (!vehicle) throw badRequest("Choose one of your vehicles", { vehicleId: "Choose one of your vehicles" });
  const { facility } = await loadFacility(input.facilityId, input.zoneId);
  const { start, end } = input;
  const now = clock.now();
  checkWindow(facility, start, end, now);

  if (await Reservation.exists({ vehicle: vehicle._id, ...activeReservationFilter(start, end, now) })) {
    throw conflict(`${vehicle.plateNumber} already has a booking that overlaps this time`);
  }

  let candidates;
  if (input.slotId) {
    const slot = await Slot.findOne({ _id: input.slotId, facility: facility._id, ...(input.zoneId && { zone: input.zoneId }) });
    if (!slot) throw notFound("Slot not found in this facility");
    if (slot.vehicleType !== vehicle.vehicleType) {
      throw badRequest(`Slot ${slot.number} is for a different vehicle type`, { slotId: "This slot doesn't fit your vehicle" });
    }
    candidates = [slot._id];
  } else {
    candidates = (await freeSlots(facility, { zoneId: input.zoneId, vehicleType: vehicle.vehicleType, start, end, now }))
      .map((s) => s._id);
  }

  const doc = { facility: facility._id, driver: user._id, vehicle: vehicle._id, startTime: start, endTime: end,
    status: "HELD", holdExpiresAt: new Date(start.getTime() + facility.reservationGraceMinutes * 60000) };
  let reservation = null;
  for (const slotId of candidates) {
    reservation = await claimSlot(slotId, doc, now);
    if (reservation) break;
  }
  if (!reservation) {
    throw conflict(input.slotId ? "That slot has just been booked by someone else. Please search again."
      : "No slot is free for your vehicle at that time. Try another zone or time.");
  }

  logger.info("reservation held", { reservationId: reservation.id, userId: user.id });
  events.publish({ type: "availability", facilityId: facility._id, reason: "BOOKED" });
  await notify({ userId: user.id, to: user.email, type: "RESERVATION_HELD",
    data: { reservationId: reservation.id, startTime: start, endTime: end } });
  return presentOne(reservation);
}

// Drivers see only their own reservations; admins can look any up.
async function findVisible(user, id) {
  const reservation = isId(id) && await Reservation.findOne({ _id: id, ...(user.role === "DRIVER" && { driver: user._id }) });
  if (!reservation) throw notFound("Reservation not found");
  return reservation;
}

async function getReservation(user, id) {
  await expireHolds();
  return presentOne(await findVisible(user, id));
}

async function listReservations(user) {
  await expireHolds();
  const reservations = await Reservation.find({ driver: user._id }).sort({ startTime: -1 }).limit(100);
  return present(reservations);
}

// A held or confirmed booking can be cancelled by its driver or an admin, which frees the slot.
async function cancelReservation(user, id) {
  await expireHolds();
  const existing = await findVisible(user, id);
  const reservation = await Reservation.findOneAndUpdate(
    { _id: existing._id, status: { $in: CANCELLABLE } },
    { status: "CANCELLED", cancelledAt: clock.now() },
    { new: true },
  );
  if (!reservation) throw conflict(`This booking is ${existing.status.toLowerCase()} and can't be cancelled`);

  events.publish({ type: "availability", facilityId: reservation.facility, reason: "CANCELLED" });
  if (user.role === "ADMIN") {
    await AuditLog.create({ event: "RESERVATION_CANCELLED", actorId: user._id, at: clock.now(),
      details: { reservationId: reservation.id } });
  }
  logger.info("reservation cancelled", { reservationId: reservation.id, by: user.id });
  return presentOne(reservation);
}

module.exports = { createReservation, getReservation, listReservations, cancelReservation, expireHolds, claimSlot };
