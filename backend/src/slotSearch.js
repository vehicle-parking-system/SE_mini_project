// Real-time slot search (VPS-F-021): which slots of a facility (optionally one zone)
// are free for a vehicle type during a whole time window.
const mongoose = require("mongoose");
const clock = require("./clock");
const Facility = require("./models/Facility");
const Zone = require("./models/Zone");
const Slot = require("./models/Slot");
const Reservation = require("./models/Reservation");
const { localParts } = require("./time");
const { VEHICLE_TYPES } = require("./validation");
const { ApiError, badRequest, notFound } = require("./errors");

const MAX_ADVANCE_DAYS = 30;
// A window may start up to this long ago, so "from now" still works after the form is filled in.
const START_GRACE_MS = 5 * 60000;
// ISO 8601 with an explicit offset, so the instant is never ambiguous
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const unprocessable = (message) => new ApiError(422, "OUTSIDE_BOOKING_RULES", message);
const isId = (v) => typeof v === "string" && mongoose.isValidObjectId(v);

// Query string -> {facilityId, zoneId?, vehicleType, start, end}, or a 400 listing every bad field.
function parseSearch(query) {
  const errors = {};
  if (!isId(query.facilityId)) errors.facilityId = "Choose a facility";
  if (query.zoneId !== undefined && query.zoneId !== "" && !isId(query.zoneId)) errors.zoneId = "Unknown zone";
  if (!VEHICLE_TYPES.includes(query.vehicleType)) errors.vehicleType = `Vehicle type must be one of ${VEHICLE_TYPES.join(", ")}`;
  for (const field of ["startTime", "endTime"]) {
    if (typeof query[field] !== "string" || !ISO_WITH_OFFSET.test(query[field]) || Number.isNaN(Date.parse(query[field]))) {
      errors[field] = "Use an ISO 8601 date-time with a time zone, e.g. 2026-11-02T14:00:00+05:30";
    }
  }
  if (!errors.startTime && !errors.endTime && Date.parse(query.endTime) <= Date.parse(query.startTime)) {
    errors.endTime = "End time must be after start time";
  }
  if (Object.keys(errors).length) throw badRequest("Some search fields are invalid", errors);

  return { facilityId: query.facilityId, zoneId: query.zoneId || null, vehicleType: query.vehicleType,
    start: new Date(query.startTime), end: new Date(query.endTime) };
}

// 422 unless the window is in the future, within MAX_ADVANCE_DAYS, and inside one day's
// opening hours (local time of the facility). Facilities open past midnight aren't supported yet.
function checkWindow(facility, start, end, now) {
  if (start.getTime() < now.getTime() - START_GRACE_MS) throw unprocessable("Choose a time window that hasn't started yet.");
  if (start.getTime() > now.getTime() + MAX_ADVANCE_DAYS * 86400000) {
    throw unprocessable(`You can search up to ${MAX_ADVANCE_DAYS} days ahead.`);
  }
  const from = localParts(start, facility.timezone);
  const to = localParts(end, facility.timezone);
  if (from.date !== to.date || from.time < facility.openTime || to.time > facility.closeTime) {
    throw unprocessable(`${facility.name} is open ${facility.openTime}–${facility.closeTime}. Choose a window within opening hours on a single day.`);
  }
}

// A slot is listed when it matches the facility, zone and vehicle type, isn't inactive,
// isn't occupied right now (a parked vehicle has no known exit time), and has no active
// reservation overlapping any part of the window. Nearest to the entry gate first.
async function searchAvailableSlots(query) {
  const { facilityId, zoneId, vehicleType, start, end } = parseSearch(query);
  const facility = await Facility.findById(facilityId);
  if (!facility) throw notFound("Facility not found");
  const zones = await Zone.find({ facility: facility._id }).sort({ name: 1 });
  if (zoneId && !zones.some((z) => z.id === zoneId)) throw notFound("Zone not found in this facility");

  const now = clock.now();
  checkWindow(facility, start, end, now);

  const taken = await Reservation.distinct("slot", {
    facility: facility._id, ...Reservation.activeReservationFilter(start, end, now),
  });
  const slots = await Slot.find({
    facility: facility._id,
    ...(zoneId && { zone: zoneId }),
    vehicleType,
    status: { $nin: ["INACTIVE", "OCCUPIED"] },
    _id: { $nin: taken },
  }).sort({ distance: 1, number: 1 });

  const zoneName = Object.fromEntries(zones.map((z) => [z.id, z.name]));
  return {
    facility: facility.toPublic(zones),
    window: { startTime: start.toISOString(), endTime: end.toISOString() },
    checkedAt: now.toISOString(),
    slots: slots.map((s) => ({ slotId: s.id, number: s.number, vehicleType: s.vehicleType, distance: s.distance,
      zoneId: s.zone.toString(), zoneName: zoneName[s.zone.toString()] })),
  };
}

module.exports = { searchAvailableSlots, parseSearch, MAX_ADVANCE_DAYS };
