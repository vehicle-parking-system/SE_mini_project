// Vehicle entry (VPS-F-001). The ANPR camera, the QR scanner or an attendant typing the plate
// reports a vehicle at an entry gate. The system finds its booking (by QR code, or by plate
// for a registered vehicle) or allocates a slot, opens a parking session and raises the barrier.
const clock = require("./clock");
const hardware = require("./hardware");
const logger = require("./logger");
const qr = require("./qr");
const Facility = require("./models/Facility");
const Gate = require("./models/Gate");
const Reservation = require("./models/Reservation");
const Session = require("./models/Session");
const Slot = require("./models/Slot");
const Vehicle = require("./models/Vehicle");
const Zone = require("./models/Zone");
const { ENTRY_SOURCES } = Session;
const { expireHolds } = require("./reservations");
const { isId } = require("./slotSearch");
const { localParts, localInstant } = require("./time");
const { VEHICLE_TYPES, PLATE_RE, normalizePlate } = require("./validation");
const { badRequest, conflict, notFound } = require("./errors");

// A booked vehicle may enter this long before its start time
const EARLY_ARRIVAL_MINUTES = 30;
// How often allocation looks again when concurrent entries or bookings keep taking its candidates
const MAX_ALLOCATION_ROUNDS = 5;

// Body -> {gateId, source, qrCode | plateNumber, vehicleType?}, or a 400 listing every bad field.
function parseEntry(body = {}) {
  const errors = {};
  if (!isId(body.gateId)) errors.gateId = "Choose an entry gate";
  if (!ENTRY_SOURCES.includes(body.source)) errors.source = `Source must be one of ${ENTRY_SOURCES.join(", ")}`;
  if (body.source === "QR") {
    if (typeof body.qrCode !== "string" || !body.qrCode.trim()) errors.qrCode = "Scan the booking's QR code";
  } else if (!PLATE_RE.test(normalizePlate(body.plateNumber))) {
    errors.plateNumber = "Enter a valid number plate, e.g. KA01AB1234";
  }
  if (body.vehicleType !== undefined && !VEHICLE_TYPES.includes(body.vehicleType)) {
    errors.vehicleType = `Vehicle type must be one of ${VEHICLE_TYPES.join(", ")}`;
  }
  if (Object.keys(errors).length) throw badRequest("Some entry fields are invalid", errors);
  return { gateId: body.gateId, source: body.source, qrCode: body.qrCode?.trim(),
    plateNumber: body.source === "QR" ? null : normalizePlate(body.plateNumber), vehicleType: body.vehicleType };
}

// The window in which a booking can be used to enter: from a little before its start until
// its hold lapses (or, once paid, until its end).
const arrivalWindow = (r) => ({
  from: new Date(r.startTime.getTime() - EARLY_ARRIVAL_MINUTES * 60000),
  until: r.status === "HELD" ? r.holdExpiresAt : r.endTime,
});

// The registered vehicle's booking at this facility that it can enter with now, if any
async function bookingForPlate(vehicle, facility, now) {
  const candidates = await Reservation.find({ vehicle: vehicle._id, facility: facility._id,
    status: { $in: ["HELD", "CONFIRMED"] }, startTime: { $lte: new Date(now.getTime() + EARLY_ARRIVAL_MINUTES * 60000) } });
  return candidates.find((r) => now <= arrivalWindow(r).until) ?? null;
}

// Rejects a booking that can't be used at this gate right now.
function checkBooking(reservation, facility, now) {
  if (!reservation.facility.equals(facility._id)) throw conflict("This booking is for another facility");
  if (!["HELD", "CONFIRMED"].includes(reservation.status)) {
    throw conflict(`This booking is ${reservation.status.toLowerCase().replace("_", " ")}`);
  }
  const { from, until } = arrivalWindow(reservation);
  if (now < from) throw conflict(`Too early: this booking starts at ${localParts(reservation.startTime, facility.timezone).time}`);
  if (now > until) throw conflict("This booking has expired");
}

// Walk-ins aren't given a slot that is booked for any time before the facility closes today,
// since nobody knows when they will leave.
async function slotsBookedToday(facility, now) {
  const today = localParts(now, facility.timezone).date;
  const closing = localInstant(today, facility.closeTime, facility.timezone);
  const until = new Date(Math.max(closing.getTime(), now.getTime() + 60000));
  return Reservation.distinct("slot", { facility: facility._id, ...Reservation.activeReservationFilter(now, until, now) });
}

// Automated nearest-slot allocation (VPS-F-002): the free slot of the vehicle type nearest to
// the entrance is marked OCCUPIED and returned; null if none is free.
//
// Uses the same slot locking as booking (reservations.js). The candidates' versions are read
// *before* checking for bookings, and a slot is taken only if its version is unchanged. So a
// booking made after that check has bumped the version and the slot is skipped, and a booking
// that comes later finds its own bump fails and withdraws. Concurrent entries race on the same
// condition: each slot goes to exactly one of them, and the others move on to the next slot.
async function allocateSlot(facility, vehicleType, now) {
  for (let round = 0; round < MAX_ALLOCATION_ROUNDS; round++) {
    const candidates = await Slot.find({ facility: facility._id, vehicleType, status: "AVAILABLE" }, "version")
      .sort({ distance: 1, number: 1 });
    const booked = new Set((await slotsBookedToday(facility, now)).map(String));
    const free = candidates.filter((c) => !booked.has(c.id));
    if (!free.length) return null;
    for (const candidate of free) {
      const slot = await Slot.findOneAndUpdate(
        { _id: candidate._id, status: "AVAILABLE", version: candidate.version },
        { status: "OCCUPIED", $inc: { version: 1 } },
        { new: true },
      );
      if (slot) return slot;
    }
  }
  return null;
}

// The booked slot, marked OCCUPIED; null if it is unusable (e.g. the last car overstayed).
const occupyBookedSlot = (reservation) => Slot.findOneAndUpdate(
  { _id: reservation.slot, status: { $nin: ["OCCUPIED", "INACTIVE"] } },
  { status: "OCCUPIED", $inc: { version: 1 } },
  { new: true },
);

const releaseSlot = (slot) => Slot.updateOne({ _id: slot._id, status: "OCCUPIED" }, { status: "AVAILABLE", $inc: { version: 1 } });

// Sessions with their slot, zone and entry gate, as the API returns them.
async function presentSessions(sessions) {
  const ids = (field) => [...new Set(sessions.map((s) => s[field].toString()))];
  const byId = (docs) => Object.fromEntries(docs.map((d) => [d.id, d]));
  const [slots, zones, gates] = await Promise.all([
    Slot.find({ _id: { $in: ids("slot") } }), Zone.find({ _id: { $in: ids("zone") } }), Gate.find({ _id: { $in: ids("entryGate") } }),
  ].map((q) => q.then(byId)));
  return sessions.map((s) => s.toPublic({ slot: slots[s.slot], zone: zones[s.zone], gate: gates[s.entryGate] }));
}
const presentSession = async (s) => (await presentSessions([s]))[0];

async function captureEntry(user, body) {
  const input = parseEntry(body);
  const gate = await Gate.findById(input.gateId);
  if (!gate || gate.type !== "ENTRY") throw notFound("Entry gate not found");
  const facility = await Facility.findById(gate.facility);
  const now = clock.now();
  await expireHolds(now);

  // Every refusal is shown on the gate's display; the barrier stays closed.
  const refuse = (err, message = err.message) => {
    hardware.display(gate.id, message);
    logger.info("entry refused", { gateId: gate.id, source: input.source, status: err.status });
    return err;
  };

  let reservation = null;
  let vehicle = null;
  if (input.source === "QR") {
    const id = qr.readBookingCode(input.qrCode);
    reservation = id && isId(id) ? await Reservation.findById(id) : null;
    if (!reservation) throw refuse(badRequest("Invalid ticket", { qrCode: "This QR code isn't a valid booking" }), "Invalid ticket");
    vehicle = await Vehicle.findById(reservation.vehicle);
  } else {
    vehicle = await Vehicle.findOne({ plateNumber: input.plateNumber });
    if (vehicle) reservation = await bookingForPlate(vehicle, facility, now);
  }
  if (reservation) {
    try {
      checkBooking(reservation, facility, now);
    } catch (err) {
      throw refuse(err);
    }
  }

  const plateNumber = vehicle?.plateNumber ?? input.plateNumber;
  const vehicleType = input.vehicleType ?? vehicle?.vehicleType;
  if (!plateNumber || !vehicleType) {
    throw refuse(badRequest("Vehicle type is required", { vehicleType: "Choose the vehicle type" }), "See attendant");
  }
  if (await Session.exists({ plateNumber, status: "ACTIVE" })) throw refuse(conflict(`${plateNumber} is already parked here`), "See attendant");

  const slot = (reservation && await occupyBookedSlot(reservation)) || await allocateSlot(facility, vehicleType, now);
  if (!slot) throw refuse(conflict("No free slot for this vehicle"), "No free slot");

  let session;
  try {
    session = await Session.create({
      facility: facility._id, zone: slot.zone, slot: slot._id, entryGate: gate._id, plateNumber, vehicleType,
      vehicle: vehicle?._id, driver: vehicle?.owner, reservation: reservation?._id, source: input.source,
      capturedBy: user._id, entryTime: now,
    });
  } catch (err) {
    await releaseSlot(slot);
    if (err.code === 11000) throw refuse(conflict(`${plateNumber} is already parked here`), "See attendant");
    throw err;
  }
  if (reservation) {
    await Reservation.updateOne({ _id: reservation._id }, { status: "CHECKED_IN", checkedInAt: now, session: session._id });
  }

  const zone = await Zone.findById(slot.zone);
  hardware.display(gate.id, `Proceed to slot ${slot.number} · ${zone.name} · ${slot.distance} m`);
  hardware.openBarrier(gate.id);
  logger.info("vehicle entered", { sessionId: session.id, gateId: gate.id, source: input.source, booked: Boolean(reservation) });
  return presentSession(session);
}

async function getSession(id) {
  const session = isId(id) && await Session.findById(id);
  if (!session) throw notFound("Session not found");
  return presentSession(session);
}

// GET /api/sessions?facilityId&status -> latest first
async function listSessions({ facilityId, status } = {}) {
  const filter = {
    ...(isId(facilityId) && { facility: facilityId }),
    ...(Session.SESSION_STATUSES.includes(status) && { status }),
  };
  return presentSessions(await Session.find(filter).sort({ entryTime: -1 }).limit(200));
}

module.exports = { captureEntry, getSession, listSessions, presentSessions, releaseSlot, EARLY_ARRIVAL_MINUTES };
