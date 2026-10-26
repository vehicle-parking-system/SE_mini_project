// Real-time slot search (VPS-F-021) for drivers, and live slot status for staff (see permissions.js).
const express = require("express");
const Slot = require("../models/Slot");
const Zone = require("../models/Zone");
const { searchAvailableSlots, isId } = require("../slotSearch");
const { notFound } = require("../errors");

const router = express.Router();

// GET /api/slots/available?facilityId&zoneId?&vehicleType&startTime&endTime
// -> {facility, window, checkedAt, slots:[{slotId, number, vehicleType, distance, zoneId, zoneName}]}
// 400 invalid fields, 404 unknown facility/zone, 422 window in the past, too far ahead or outside opening hours
router.get("/available", async (req, res) => {
  res.json(await searchAvailableSlots(req.query));
});

// GET /api/slots/:id -> {slotId, number, vehicleType, distance, status: AVAILABLE|OCCUPIED|RESERVED|INACTIVE, zoneId, zoneName, facilityId}
router.get("/:id", async (req, res) => {
  const slot = isId(req.params.id) && await Slot.findById(req.params.id);
  if (!slot) throw notFound("Slot not found");
  res.json(slot.toPublic(await Zone.findById(slot.zone)));
});

module.exports = router;
