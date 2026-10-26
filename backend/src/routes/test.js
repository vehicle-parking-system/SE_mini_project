// Test-support hooks for the acceptance tests in tests/. Mounted ONLY when NODE_ENV=test.
const express = require("express");
const mongoose = require("mongoose");
const clock = require("../clock");
const notifications = require("../notifications");
const { createAccount } = require("../accounts");
const { createFacility } = require("../facilities");
const Reservation = require("../models/Reservation");
const Slot = require("../models/Slot");

const router = express.Router();

// POST /api/test/reset <fixture> -> {ids:{<fixture key>: <real id>}}
// Wipes the database and seeds the fixture from tests/helpers/fixture.js.
// Users, vehicles, facilities, zones and slots are seeded; gates and rates follow with their features.
router.post("/reset", async (req, res) => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  clock.reset();
  notifications.clear();

  const ids = {};
  for (const u of req.body?.users ?? []) {
    const { user, vehicles } = await createAccount({ ...u, vehicles: (u.vehicles ?? []).map(({ key, ...v }) => v) });
    ids[u.key] = user.id;
    (u.vehicles ?? []).forEach((v, i) => { ids[v.key] = vehicles[i].id; });
  }
  for (const f of req.body?.facilities ?? []) Object.assign(ids, (await createFacility(f)).ids);
  res.json({ ids });
});

// POST /api/test/clock {now} -> {now}
router.post("/clock", (req, res) => {
  clock.set(req.body.now);
  res.json({ now: clock.now().toISOString() });
});

// POST /api/test/reservations {slotId, startTime, endTime, status?, holdExpiresAt?} -> {reservationId}
// Inserts a reservation directly, so slot search can be tested before reservations can be booked.
router.post("/reservations", async (req, res) => {
  const slot = await Slot.findById(req.body.slotId);
  const reservation = await Reservation.create({
    slot: slot._id, facility: slot.facility, startTime: req.body.startTime, endTime: req.body.endTime,
    status: req.body.status ?? "CONFIRMED", holdExpiresAt: req.body.holdExpiresAt,
  });
  res.status(201).json({ reservationId: reservation.id });
});

// GET /api/test/notifications -> {notifications:[{to, channel, type, data, at}]}
router.get("/notifications", (_req, res) => {
  res.json({ notifications: notifications.sent() });
});

module.exports = router;
