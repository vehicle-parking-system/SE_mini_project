// Real-time slot search (VPS-F-021). Drivers only (see permissions.js).
const express = require("express");
const { searchAvailableSlots } = require("../slotSearch");

const router = express.Router();

// GET /api/slots/available?facilityId&zoneId?&vehicleType&startTime&endTime
// -> {facility, window, checkedAt, slots:[{slotId, number, vehicleType, distance, zoneId, zoneName}]}
// 400 invalid fields, 404 unknown facility/zone, 422 window in the past, too far ahead or outside opening hours
router.get("/available", async (req, res) => {
  res.json(await searchAvailableSlots(req.query));
});

module.exports = router;
