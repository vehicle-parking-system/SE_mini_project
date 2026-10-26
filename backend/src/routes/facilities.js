const express = require("express");
const Facility = require("../models/Facility");
const Zone = require("../models/Zone");

const router = express.Router();

// GET /api/facilities -> {facilities:[{id, name, address, timezone, openTime, closeTime, zones:[{id, name}]}]}
// What a driver picks from when searching for a slot.
router.get("/", async (_req, res) => {
  const [facilities, zones] = await Promise.all([Facility.find().sort({ name: 1 }), Zone.find().sort({ name: 1 })]);
  res.json({
    facilities: facilities.map((f) => f.toPublic(zones.filter((z) => z.facility.equals(f._id)))),
  });
});

module.exports = router;
