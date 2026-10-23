// Test-support hooks for the acceptance tests in tests/. Mounted ONLY when NODE_ENV=test.
const express = require("express");
const mongoose = require("mongoose");
const clock = require("../clock");
const { createAccount } = require("../accounts");

const router = express.Router();

// POST /api/test/reset <fixture> -> {ids:{<fixture key>: <real id>}}
// Wipes the database and seeds the fixture from tests/helpers/fixture.js.
// Only users and their vehicles are seeded so far; facilities follow with their feature.
router.post("/reset", async (req, res) => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  clock.reset();

  const ids = {};
  for (const u of req.body?.users ?? []) {
    const { user, vehicles } = await createAccount({ ...u, vehicles: (u.vehicles ?? []).map(({ key, ...v }) => v) });
    ids[u.key] = user.id;
    (u.vehicles ?? []).forEach((v, i) => { ids[v.key] = vehicles[i].id; });
  }
  res.json({ ids });
});

// POST /api/test/clock {now} -> {now}
router.post("/clock", (req, res) => {
  clock.set(req.body.now);
  res.json({ now: clock.now().toISOString() });
});

module.exports = router;
