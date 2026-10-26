// Gate operations (Attendant Kiosk / Hardware Abstraction Service). Staff only (see permissions.js).
const express = require("express");
const entry = require("../entry");
const exit = require("../exit");
const { occupancy } = require("../occupancy");

const router = express.Router();

// POST /api/entry {gateId, source: ANPR|QR|MANUAL, plateNumber | qrCode, vehicleType?}
// -> 201 {sessionId, slotId, slotNumber, zoneName, plateNumber, entryTime, reservationId, ...}
// 400 invalid fields or ticket, 404 unknown gate,
// 409 FACILITY_FULL when no slot is free for the vehicle (display shows "Facility Full", barrier stays closed),
// 409 CONFLICT when it is already parked or its booking can't be used now
router.post("/entry", async (req, res) => {
  res.status(201).json(await entry.captureEntry(req.user, req.body));
});

// POST /api/tickets/scan {qrCode} -> the session {sessionId, entryTime, slotNumber, plateNumber, status, ...}
// 400 if the code isn't a valid entry ticket
router.post("/tickets/scan", async (req, res) => {
  res.json(await entry.scanTicket(req.body?.qrCode));
});

// POST /api/exit {gateId, sessionId | qrCode | plateNumber}
// 402 PAYMENT_REQUIRED {amount, duration, chargedHours, ratePerHour, paymentStatus} while the fee is unpaid
// (the barrier stays closed); 400 invalid fields or ticket, 404 unknown gate or session, 409 already left
router.post("/exit", async (req, res) => {
  res.json(await exit.processExit(req.user, req.body));
});

// GET /api/sessions?facilityId&status=ACTIVE|CLOSED -> {sessions:[...]} latest first
router.get("/sessions", async (req, res) => {
  res.json({ sessions: await entry.listSessions(req.query) });
});

// GET /api/sessions/:id -> {sessionId, plateNumber, gateId, entryTime, exitTime, slotId, slotNumber, status, ...}
router.get("/sessions/:id", async (req, res) => {
  res.json(await entry.getSession(req.params.id));
});

// GET /api/occupancy/:facilityId -> {capacity, occupied, booked, free, full, byVehicleType:[...], byZone:[...]}
router.get("/occupancy/:facilityId", async (req, res) => {
  res.json(await occupancy(req.params.facilityId));
});

module.exports = router;
