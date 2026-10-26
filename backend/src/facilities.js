// Creating facilities with their gates, zones and slots. Used by the test fixture and the demo
// seed script until the admin console (Lot / Zone / Slot configuration) exists.
const Facility = require("./models/Facility");
const Gate = require("./models/Gate");
const Zone = require("./models/Zone");
const Slot = require("./models/Slot");

// def: {key?, name, openTime, closeTime, timezone?, address?, reservationGraceMinutes?,
//       gates?: [{key?, name?, type: ENTRY|EXIT}],
//       zones: [{key?, name, slots: [{key?, number, vehicleType, distance?, status?}]}]}
// Without gates, the facility gets one entry and one exit gate.
// Returns the facility and {<key>: <id>} for every keyed facility, gate, zone and slot.
async function createFacility(def) {
  const { key, zones = [], gates = [{ type: "ENTRY" }, { type: "EXIT" }], ...fields } = def;
  const facility = await Facility.create({
    name: fields.name, address: fields.address, timezone: fields.timezone, openTime: fields.openTime,
    closeTime: fields.closeTime, reservationGraceMinutes: fields.reservationGraceMinutes,
  });
  const ids = key ? { [key]: facility.id } : {};

  const counts = { ENTRY: 0, EXIT: 0 };
  for (const g of gates) {
    counts[g.type] += 1;
    const gate = await Gate.create({ facility: facility._id, type: g.type,
      name: g.name ?? `${g.type === "ENTRY" ? "Entry" : "Exit"} ${counts[g.type]}` });
    if (g.key) ids[g.key] = gate.id;
  }

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
