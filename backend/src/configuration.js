// Lot, zone, slot and pricing configuration (VPS-F-040, VPS-F-041) for the Admin Console.
//
// - Facilities, zones, slots and gates are created and edited, never deleted: parking sessions,
//   bookings and receipts point at them. A slot that should no longer be used is deactivated.
// - A slot is deactivated (or its vehicle type changed) only when nobody is parked in it and no
//   active booking holds it. The check uses the same slot version as booking and allocation, so a
//   booking racing the change either lands first (and the change is refused) or is withdrawn.
// - Rates are upserted per facility, zone (or facility-wide) and vehicle type. A vehicle keeps the
//   rate it entered with (pricing.js), so a change applies to vehicles that enter after it.
// - Every change is audited as CONFIG_CHANGED.
const cache = require("./cache");
const clock = require("./clock");
const logger = require("./logger");
const events = require("./events");
const AuditLog = require("./models/AuditLog");
const Facility = require("./models/Facility");
const Gate = require("./models/Gate");
const Rate = require("./models/Rate");
const Reservation = require("./models/Reservation");
const Slot = require("./models/Slot");
const Zone = require("./models/Zone");
const { createFacility } = require("./facilities");
const { isId } = require("./slotSearch");
const { VEHICLE_TYPES } = require("./validation");
const { badRequest, conflict, notFound } = require("./errors");

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLOT_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,11}$/;
const MAX_SLOTS_PER_REQUEST = 500;
const MAX_RATE = 100000;
const FAR_FUTURE = new Date("9999-12-31T00:00:00Z");

const isString = (v) => typeof v === "string";
const has = (body, field) => body[field] !== undefined;

function fail(errors, message = "Some fields are invalid") {
  if (Object.keys(errors).length) throw badRequest(message, errors);
}

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const nameOk = (v, max = 80) => isString(v) && v.trim().length >= 1 && v.trim().length <= max;
const minutesOk = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

// Facility fields shared by create and update; only the fields present are checked.
function facilityFieldErrors(errors, body) {
  if (has(body, "name") && !nameOk(body.name)) errors.name = "Name must be 1–80 characters";
  if (has(body, "address") && body.address !== null && !(isString(body.address) && body.address.length <= 200)) {
    errors.address = "Address must be at most 200 characters";
  }
  if (has(body, "timezone") && !(isString(body.timezone) && validTimezone(body.timezone))) {
    errors.timezone = "Use an IANA time zone, e.g. Asia/Kolkata";
  }
  for (const f of ["openTime", "closeTime"]) {
    if (has(body, f) && !(isString(body[f]) && HHMM_RE.test(body[f]))) errors[f] = "Use a 24-hour time, e.g. 06:00";
  }
  if (has(body, "reservationGraceMinutes") && !minutesOk(body.reservationGraceMinutes, 240)) {
    errors.reservationGraceMinutes = "Grace period must be 0–240 minutes";
  }
  if (has(body, "refundCutoffMinutes") && !minutesOk(body.refundCutoffMinutes, 10080)) {
    errors.refundCutoffMinutes = "Refund cut-off must be 0–10080 minutes";
  }
}

// Search and booking need a window inside one day's opening hours, so closing must be after opening.
function hoursErrors(errors, openTime, closeTime) {
  if (!errors.openTime && !errors.closeTime && openTime >= closeTime) errors.closeTime = "Closing time must be after opening time";
}

// [{number, vehicleType, distance?}] -> errors under `${field}[i].*`; numbers must be unique in the list
function slotListErrors(errors, slots, field) {
  if (!Array.isArray(slots) || slots.length > MAX_SLOTS_PER_REQUEST) {
    errors[field] = `Give at most ${MAX_SLOTS_PER_REQUEST} slots`;
    return;
  }
  slots.forEach((s, i) => slotErrors(errors, s ?? {}, `${field}[${i}]`, true));
  const numbers = slots.map((s) => (isString(s?.number) ? s.number.trim().toUpperCase() : ""));
  if (new Set(numbers).size !== numbers.length) errors[field] = "The same slot number appears twice";
}

function slotErrors(errors, s, prefix, required) {
  const key = (f) => (prefix ? `${prefix}.${f}` : f);
  if ((required || has(s, "number")) && !(isString(s.number) && SLOT_NUMBER_RE.test(s.number.trim()))) {
    errors[key("number")] = "Slot number must be 1–12 letters, digits or dashes, e.g. A-01";
  }
  if ((required || has(s, "vehicleType")) && !VEHICLE_TYPES.includes(s.vehicleType)) {
    errors[key("vehicleType")] = `Vehicle type must be one of ${VEHICLE_TYPES.join(", ")}`;
  }
  if (has(s, "distance") && !(typeof s.distance === "number" && s.distance >= 0 && s.distance <= 100000)) {
    errors[key("distance")] = "Distance must be 0–100000 metres";
  }
  if (has(s, "active") && typeof s.active !== "boolean") errors[key("active")] = "Active must be true or false";
}

const cleanSlot = (s) => ({ number: s.number.trim().toUpperCase(), vehicleType: s.vehicleType, distance: s.distance ?? 0,
  ...(s.active === false && { status: "INACTIVE" }) });

function gateErrors(errors, g, prefix) {
  const key = (f) => (prefix ? `${prefix}.${f}` : f);
  if (has(g, "name") && !nameOk(g.name, 40)) errors[key("name")] = "Gate name must be 1–40 characters";
  if (!Gate.GATE_TYPES.includes(g.type)) errors[key("type")] = "Gate type must be ENTRY or EXIT";
}

// POST /api/admin/facilities body -> the definition createFacility() takes
function parseNewFacility(body = {}) {
  const errors = {};
  if (!has(body, "name")) errors.name = "Name is required";
  if (!has(body, "openTime")) errors.openTime = "Opening time is required";
  if (!has(body, "closeTime")) errors.closeTime = "Closing time is required";
  facilityFieldErrors(errors, body);
  hoursErrors(errors, body.openTime, body.closeTime);

  const zones = body.zones ?? [];
  if (!Array.isArray(zones) || zones.length > 50) errors.zones = "Give at most 50 zones";
  else {
    zones.forEach((z, i) => {
      if (!nameOk(z?.name, 40)) errors[`zones[${i}].name`] = "Zone name must be 1–40 characters";
      slotListErrors(errors, z?.slots ?? [], `zones[${i}].slots`);
    });
    const all = zones.flatMap((z) => (Array.isArray(z?.slots) ? z.slots : [])).map((s) => String(s?.number).trim().toUpperCase());
    if (!errors.zones && new Set(all).size !== all.length) errors.zones = "Slot numbers must be unique across the facility";
  }

  const gates = body.gates ?? [{ type: "ENTRY" }, { type: "EXIT" }];
  if (!Array.isArray(gates) || gates.length > 20) errors.gates = "Give at most 20 gates";
  else gates.forEach((g, i) => gateErrors(errors, g ?? {}, `gates[${i}]`));
  fail(errors, "Some facility fields are invalid");

  return {
    name: body.name.trim(), address: body.address?.trim() || undefined, timezone: body.timezone, openTime: body.openTime,
    closeTime: body.closeTime, reservationGraceMinutes: body.reservationGraceMinutes,
    refundPolicy: body.refundCutoffMinutes === undefined ? undefined : { fullRefundIfCancelledMinutesBefore: body.refundCutoffMinutes },
    gates: gates.map((g) => ({ type: g.type, ...(g.name && { name: g.name.trim() }) })),
    zones: zones.map((z) => ({ name: z.name.trim(), slots: (z.slots ?? []).map(cleanSlot) })),
  };
}

// Every change ends here: the gates' cached configuration is dropped so it is read fresh.
async function audit(user, action, details) {
  cache.clear();
  await AuditLog.create({ event: "CONFIG_CHANGED", actorId: user._id, at: clock.now(), details: { action, ...details } });
  logger.info("configuration changed", { action, by: user.id, ...details });
}

async function findOr404(Model, id, what) {
  const doc = isId(id) && await Model.findById(id);
  if (!doc) throw notFound(`${what} not found`);
  return doc;
}

const presentSlot = (s) => ({ slotId: s.id, number: s.number, vehicleType: s.vehicleType, distance: s.distance, status: s.status,
  active: s.status !== "INACTIVE", zoneId: s.zone.toString() });

// A facility with everything configured in it, as the Admin Console shows it
async function presentFacility(facility) {
  const [zones, slots, gates, rates] = await Promise.all([
    Zone.find({ facility: facility._id }).sort({ name: 1 }),
    Slot.find({ facility: facility._id }).sort({ distance: 1, number: 1 }),
    Gate.find({ facility: facility._id }).sort({ type: 1, name: 1 }),
    Rate.find({ facility: facility._id }).sort({ vehicleType: 1 }),
  ]);
  return {
    id: facility.id, name: facility.name, address: facility.address ?? null, timezone: facility.timezone,
    openTime: facility.openTime, closeTime: facility.closeTime, reservationGraceMinutes: facility.reservationGraceMinutes,
    refundCutoffMinutes: facility.refundCutoffMinutes,
    gates: gates.map((g) => g.toPublic()),
    zones: zones.map((z) => ({ id: z.id, name: z.name, slots: slots.filter((s) => s.zone.equals(z._id)).map(presentSlot) })),
    rates: rates.map((r) => r.toPublic()),
  };
}

async function listFacilities() {
  const facilities = await Facility.find().sort({ name: 1 });
  return Promise.all(facilities.map(presentFacility));
}

const getFacility = async (id) => presentFacility(await findOr404(Facility, id, "Facility"));

async function addFacility(user, body) {
  const def = parseNewFacility(body);
  const { facility } = await createFacility(def);
  await audit(user, "FACILITY_CREATED", { facilityId: facility.id });
  events.publish({ type: "availability", facilityId: facility._id, reason: "CONFIG" });
  return presentFacility(facility);
}

async function updateFacility(user, id, body = {}) {
  const facility = await findOr404(Facility, id, "Facility");
  const errors = {};
  facilityFieldErrors(errors, body);
  hoursErrors(errors, body.openTime ?? facility.openTime, body.closeTime ?? facility.closeTime);
  const fields = ["name", "address", "timezone", "openTime", "closeTime", "reservationGraceMinutes", "refundCutoffMinutes"]
    .filter((f) => has(body, f));
  if (!fields.length && !Object.keys(errors).length) errors.body = "Nothing to update";
  fail(errors, "Some facility fields are invalid");

  for (const f of fields) facility[f] = isString(body[f]) ? body[f].trim() : body[f];
  await facility.save();
  await audit(user, "FACILITY_UPDATED", { facilityId: facility.id, fields });
  events.publish({ type: "availability", facilityId: facility._id, reason: "CONFIG" });
  return presentFacility(facility);
}

// Inserts slots into a zone; slot numbers must be new in the facility (409 otherwise)
async function insertSlots(zone, slots) {
  const numbers = slots.map((s) => s.number);
  const taken = await Slot.find({ facility: zone.facility, number: { $in: numbers } }, "number");
  if (taken.length) throw conflict(`Slot ${taken[0].number} already exists in this facility`);
  try {
    return await Slot.insertMany(slots.map((s) => ({ ...s, facility: zone.facility, zone: zone._id })), { ordered: true });
  } catch (err) {
    if (err.code === 11000) throw conflict("A slot with that number already exists in this facility");
    throw err;
  }
}

async function addZone(user, facilityId, body = {}) {
  const facility = await findOr404(Facility, facilityId, "Facility");
  const errors = {};
  if (!nameOk(body.name, 40)) errors.name = "Zone name must be 1–40 characters";
  slotListErrors(errors, body.slots ?? [], "slots");
  fail(errors, "Some zone fields are invalid");
  if (await Zone.exists({ facility: facility._id, name: body.name.trim() })) throw conflict("This facility already has a zone with that name");

  const zone = await Zone.create({ facility: facility._id, name: body.name.trim() });
  const slots = await insertSlots(zone, (body.slots ?? []).map(cleanSlot));
  await audit(user, "ZONE_CREATED", { facilityId: facility.id, zoneId: zone.id, slots: slots.length });
  events.publish({ type: "availability", facilityId: facility._id, reason: "CONFIG" });
  return { id: zone.id, name: zone.name, slots: slots.map(presentSlot) };
}

async function updateZone(user, id, body = {}) {
  const zone = await findOr404(Zone, id, "Zone");
  if (!nameOk(body.name, 40)) throw badRequest("Some zone fields are invalid", { name: "Zone name must be 1–40 characters" });
  const name = body.name.trim();
  if (await Zone.exists({ facility: zone.facility, name, _id: { $ne: zone._id } })) throw conflict("This facility already has a zone with that name");
  zone.name = name;
  await zone.save();
  await audit(user, "ZONE_UPDATED", { zoneId: zone.id });
  return { id: zone.id, name: zone.name };
}

async function addSlots(user, zoneId, body = {}) {
  const zone = await findOr404(Zone, zoneId, "Zone");
  const errors = {};
  if (!Array.isArray(body.slots) || !body.slots.length) errors.slots = "Give at least one slot";
  else slotListErrors(errors, body.slots, "slots");
  fail(errors, "Some slot fields are invalid");

  const slots = await insertSlots(zone, body.slots.map(cleanSlot));
  await audit(user, "SLOTS_ADDED", { zoneId: zone.id, count: slots.length });
  events.publish({ type: "availability", facilityId: zone.facility, reason: "CONFIG" });
  return slots.map(presentSlot);
}

// Changing a slot's vehicle type or taking it out of use must not strand a parked vehicle or a booking.
async function assertSlotUnused(slot, now) {
  if (slot.status === "OCCUPIED") throw conflict(`A vehicle is parked in slot ${slot.number}. Try again once it has left`);
  const booked = await Reservation.countDocuments({ slot: slot._id, ...Reservation.activeReservationFilter(now, FAR_FUTURE, now) });
  if (booked) throw conflict(`Slot ${slot.number} has ${booked} active booking${booked === 1 ? "" : "s"}. Cancel ${booked === 1 ? "it" : "them"} first`);
}

// PATCH /api/admin/slots/:id {number?, vehicleType?, distance?, active?}
async function updateSlot(user, id, body = {}) {
  const errors = {};
  slotErrors(errors, body, "", false);
  const fields = ["number", "vehicleType", "distance", "active"].filter((f) => has(body, f));
  if (!fields.length && !Object.keys(errors).length) errors.body = "Nothing to update";
  fail(errors, "Some slot fields are invalid");

  const slot = await findOr404(Slot, id, "Slot");
  const update = {};
  if (has(body, "number")) update.number = body.number.trim().toUpperCase();
  if (has(body, "distance")) update.distance = body.distance;
  if (has(body, "vehicleType") && body.vehicleType !== slot.vehicleType) update.vehicleType = body.vehicleType;
  if (body.active === false && slot.status !== "INACTIVE") update.status = "INACTIVE";
  if (body.active === true && slot.status === "INACTIVE") update.status = "AVAILABLE";

  // Read the version before checking for parked vehicles and bookings; the update applies only
  // if nothing touched the slot since (see reservations.js, claimSlot).
  if (update.status === "INACTIVE" || update.vehicleType) await assertSlotUnused(slot, clock.now());
  let updated;
  try {
    updated = await Slot.findOneAndUpdate(
      { _id: slot._id, version: slot.version, ...(update.status === "INACTIVE" && { status: { $ne: "OCCUPIED" } }) },
      { ...update, $inc: { version: 1 } },
      { new: true },
    );
  } catch (err) {
    if (err.code === 11000) throw conflict(`Slot ${update.number} already exists in this facility`);
    throw err;
  }
  if (!updated) throw conflict(`Slot ${slot.number} changed while you were editing it. Try again`);

  if (update.status) events.slotChanged(updated, "CONFIG");
  await audit(user, update.status === "INACTIVE" ? "SLOT_DEACTIVATED" : update.status === "AVAILABLE" ? "SLOT_ACTIVATED" : "SLOT_UPDATED",
    { slotId: updated.id, fields });
  return presentSlot(updated);
}

async function addGate(user, facilityId, body = {}) {
  const facility = await findOr404(Facility, facilityId, "Facility");
  const errors = {};
  if (!has(body, "name")) errors.name = "Gate name is required";
  gateErrors(errors, body);
  fail(errors, "Some gate fields are invalid");
  const gate = await Gate.create({ facility: facility._id, name: body.name.trim(), type: body.type });
  await audit(user, "GATE_CREATED", { facilityId: facility.id, gateId: gate.id });
  return gate.toPublic();
}

async function updateGate(user, id, body = {}) {
  const gate = await findOr404(Gate, id, "Gate");
  if (!nameOk(body.name, 40)) throw badRequest("Some gate fields are invalid", { name: "Gate name must be 1–40 characters" });
  gate.name = body.name.trim();
  await gate.save();
  await audit(user, "GATE_UPDATED", { gateId: gate.id });
  return gate.toPublic();
}

async function listRates({ facilityId } = {}) {
  const rates = await Rate.find(isId(facilityId) ? { facility: facilityId } : {}).sort({ facility: 1, vehicleType: 1 });
  return rates.map((r) => r.toPublic());
}

// PUT /api/admin/rates {facilityId, zoneId?, vehicleType, ratePerHour} -> {rate, created}
async function setRate(user, body = {}) {
  const errors = {};
  if (!isId(body.facilityId)) errors.facilityId = "Choose a facility";
  if (body.zoneId !== undefined && body.zoneId !== null && body.zoneId !== "" && !isId(body.zoneId)) errors.zoneId = "Unknown zone";
  if (!VEHICLE_TYPES.includes(body.vehicleType)) errors.vehicleType = `Vehicle type must be one of ${VEHICLE_TYPES.join(", ")}`;
  if (!(typeof body.ratePerHour === "number" && body.ratePerHour >= 0 && body.ratePerHour <= MAX_RATE
    && Math.round(body.ratePerHour * 100) === body.ratePerHour * 100)) {
    errors.ratePerHour = `Rate must be ₹0–${MAX_RATE} per hour, with at most 2 decimals`;
  }
  fail(errors, "Some rate fields are invalid");

  const facility = await findOr404(Facility, body.facilityId, "Facility");
  const zone = body.zoneId ? await Zone.findOne({ _id: body.zoneId, facility: facility._id }) : null;
  if (body.zoneId && !zone) throw notFound("Zone not found in this facility");

  const key = { facility: facility._id, zone: zone?._id ?? null, vehicleType: body.vehicleType };
  const before = await Rate.findOne(key);
  const rate = await Rate.findOneAndUpdate(key, { ratePerHour: body.ratePerHour }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await audit(user, "RATE_SET", { facilityId: facility.id, zoneId: zone?.id ?? null, vehicleType: body.vehicleType,
    from: before?.ratePerHour ?? null, to: body.ratePerHour });
  return { rate: rate.toPublic(), created: !before };
}

async function deleteRate(user, id) {
  const rate = await findOr404(Rate, id, "Rate");
  await rate.deleteOne();
  await audit(user, "RATE_DELETED", { rateId: rate.id, facilityId: rate.facility.toString(), vehicleType: rate.vehicleType });
}

module.exports = { listFacilities, getFacility, addFacility, updateFacility, addZone, updateZone, addSlots, updateSlot,
  addGate, updateGate, listRates, setRate, deleteRate };
