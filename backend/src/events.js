// Live slot events (VPS-F-012). Whenever a slot changes — a vehicle parks or leaves, a booking
// takes or releases it, an admin changes it — an event is published here and pushed to every
// open GET /api/events stream, so gate screens and driver searches update at once instead of
// waiting for their next refresh.
//
// The bus is in-process: with several API instances, publish through a shared broker
// (e.g. Redis pub/sub) instead.
const { EventEmitter } = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open stream

// event: {type: "slot", facilityId, slotId, status, reason} | {type: "availability", facilityId, reason}
function publish(event) {
  bus.emit("event", { ...event, facilityId: String(event.facilityId), ...(event.slotId && { slotId: String(event.slotId) }),
    at: new Date().toISOString() });
}

const slotChanged = (slot, reason) =>
  publish({ type: "slot", facilityId: slot.facility, slotId: slot._id, number: slot.number, status: slot.status, reason });

function subscribe(listener) {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}

module.exports = { publish, slotChanged, subscribe };
