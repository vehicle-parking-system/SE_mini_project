// Parking fee calculation (VPS-F-010): total duration × the rate card's hourly rate.
//
// - Duration is measured from entry to exit and rounded to the nearest minute.
// - Every started hour is charged in full: 30 min = 1 h, 61 min = 2 h (tests/README.md,
//   "Fee rounding"; the SRS only says "within rounding rules"). The first hour starts on
//   entry, so even a stay of a few seconds is one hour.
// - The rate is looked up when the vehicle enters and kept on its session, so a later rate
//   change applies to vehicles that enter after it, never to one already parked.
const Rate = require("./models/Rate");

const durationMinutes = (from, to) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
const chargedHours = (minutes) => Math.max(1, Math.ceil(minutes / 60));
const feeFor = (minutes, ratePerHour) => chargedHours(minutes) * ratePerHour;

// The hourly rate for a vehicle type in a zone: the zone's own rate, else the facility-wide
// one; null if neither is configured.
async function rateFor(facilityId, zoneId, vehicleType) {
  const rates = await Rate.find({ facility: facilityId, vehicleType, zone: { $in: [zoneId, null] } });
  const rate = rates.find((r) => r.zone?.equals(zoneId)) ?? rates.find((r) => !r.zone);
  return rate ? rate.ratePerHour : null;
}

// What a session costs if it ends at `until`
function quote(session, until) {
  const minutes = durationMinutes(session.entryTime, until);
  return { duration: minutes, chargedHours: chargedHours(minutes), ratePerHour: session.ratePerHour,
    amount: feeFor(minutes, session.ratePerHour), quotedAt: until.toISOString() };
}

module.exports = { durationMinutes, chargedHours, feeFor, rateFor, quote };
