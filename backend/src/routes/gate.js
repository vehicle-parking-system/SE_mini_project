// Gate operations (Attendant Kiosk / Hardware Abstraction Service). Staff only (see permissions.js).
const express = require("express");
const entry = require("../entry");

const router = express.Router();

// POST /api/entry {gateId, source: ANPR|QR|MANUAL, plateNumber | qrCode, vehicleType?}
// -> 201 {sessionId, slotId, slotNumber, zoneName, plateNumber, entryTime, reservationId, ...}
// 400 invalid fields or ticket, 404 unknown gate, 409 no free slot, already parked, or a booking that can't be used now
router.post("/entry", async (req, res) => {
  res.status(201).json(await entry.captureEntry(req.user, req.body));
});

// GET /api/sessions?facilityId&status=ACTIVE|CLOSED -> {sessions:[...]} latest first
router.get("/sessions", async (req, res) => {
  res.json({ sessions: await entry.listSessions(req.query) });
});

// GET /api/sessions/:id -> {sessionId, plateNumber, gateId, entryTime, exitTime, slotId, slotNumber, status, ...}
router.get("/sessions/:id", async (req, res) => {
  res.json(await entry.getSession(req.params.id));
});

module.exports = router;
