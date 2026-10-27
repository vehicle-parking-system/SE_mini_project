const express = require("express");
const Facility = require("../models/Facility");
const Zone = require("../models/Zone");
const Gate = require("../models/Gate");

const router = express.Router();

// GET /api/facilities -> {facilities:[{id, name, address, timezone, openTime, closeTime, zones:[{id, name}], gates?}]}
// What a driver picks from when searching for a slot. Staff also get the gates:[{id, name, type}] they operate.
router.get("/", async (req, res) => {
  const staff = req.user.role !== "DRIVER";
  const [facilities, zones, gates] = await Promise.all([
    Facility.find().sort({ name: 1 }), Zone.find().sort({ name: 1 }), staff ? Gate.find().sort({ type: 1, name: 1 }) : [],
  ]);
  const of = (docs, f) => docs.filter((d) => d.facility.equals(f._id));
  res.json({ facilities: facilities.map((f) => f.toPublic(of(zones, f), staff ? of(gates, f) : undefined)) });
});

module.exports = router;
