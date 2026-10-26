// Creating facilities with their zones and slots. Used by the test fixture and the demo
// seed script until the admin console (Lot / Zone / Slot configuration) exists.
const Facility = require("./models/Facility");
const Zone = require("./models/Zone");
const Slot = require("./models/Slot");

// def: {key?, name, openTime, closeTime, timezone?, address?, reservationGraceMinutes?,
//       zones: [{key?, name, slots: [{key?, number, vehicleType, distance?, status?}]}]}
// Returns the facility and {<key>: <id>} for every keyed facility, zone and slot.
async function createFacility(def) {
  const { key, zones = [], ...fields } = def;
  const facility = await Facility.create({
    name: fields.name, address: fields.address, timezone: fields.timezone, openTime: fields.openTime,
    closeTime: fields.closeTime, reservationGraceMinutes: fields.reservationGraceMinutes,
  });
  const ids = key ? { [key]: facility.id } : {};

  for (const z of zones) {
    const zone = await Zone.create({ facility: facility._id, name: z.name });
    if (z.key) ids[z.key] = zone.id;
    const slots = await Slot.insertMany((z.slots ?? []).map((s) => ({
      facility: facility._id, zone: zone._id, number: s.number, vehicleType: s.vehicleType,
      distance: s.distance, status: s.status,
    })));
    (z.slots ?? []).forEach((s, i) => { if (s.key) ids[s.key] = slots[i].id; });
  }
  return { facility, ids };
}

module.exports = { createFacility };
