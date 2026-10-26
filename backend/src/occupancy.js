// Live occupancy of a facility (VPS-F-003): how many slots exist, are occupied, are held for a
// booking right now, and are free, in total, per vehicle type and per zone.
const clock = require("./clock");
const Facility = require("./models/Facility");
const Reservation = require("./models/Reservation");
const Slot = require("./models/Slot");
const Zone = require("./models/Zone");
const { isId } = require("./slotSearch");
const { notFound } = require("./errors");

const emptyCount = () => ({ capacity: 0, occupied: 0, booked: 0, free: 0 });

async function occupancy(facilityId) {
  const facility = isId(facilityId) && await Facility.findById(facilityId);
  if (!facility) throw notFound("Facility not found");
  const now = clock.now();
  const [slots, zones, bookedNow] = await Promise.all([
    Slot.find({ facility: facility._id }, "zone vehicleType status"),
    Zone.find({ facility: facility._id }).sort({ name: 1 }),
    Reservation.distinct("slot", { facility: facility._id,
      ...Reservation.activeReservationFilter(now, new Date(now.getTime() + 60000), now) }),
  ]);
  const booked = new Set(bookedNow.map(String));

  const total = emptyCount();
  const byType = {};
  const byZone = Object.fromEntries(zones.map((z) => [z.id, { zoneId: z.id, name: z.name, ...emptyCount() }]));
  for (const slot of slots) {
    if (slot.status === "INACTIVE") continue;
    const state = slot.status === "OCCUPIED" ? "occupied" : booked.has(slot.id) ? "booked" : "free";
    for (const count of [total, byType[slot.vehicleType] ??= emptyCount(), byZone[slot.zone.toString()]]) {
      count.capacity += 1;
      count[state] += 1;
    }
  }
  return {
    facilityId: facility.id, name: facility.name, ...total, full: total.free === 0, checkedAt: now.toISOString(),
    byVehicleType: Object.entries(byType).map(([vehicleType, count]) => ({ vehicleType, ...count, full: count.free === 0 })),
    byZone: Object.values(byZone),
  };
}

module.exports = { occupancy };
