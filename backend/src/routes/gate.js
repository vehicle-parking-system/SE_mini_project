// Gate operations (Attendant Kiosk / Hardware Abstraction Service). Staff only (see permissions.js).
const express = require("express");
const entry = require("../entry");
const exit = require("../exit");
const { occupancy } = require("../occupancy");
const receipts = require("../receipts");
const gates = require("../gates");
const { timeGate } = require("../metrics");

const router = express.Router();

// POST /api/entry {gateId, source: ANPR|QR|MANUAL, plateNumber | qrCode, vehicleType?}
// -> 201 {sessionId, slotId, slotNumber, zoneName, plateNumber, entryTime, reservationId, ...}
// 400 invalid fields or ticket, 404 unknown gate,
// 409 FACILITY_FULL when no slot is free for the vehicle (display shows "Facility Full", barrier stays closed),
// 409 CONFLICT when it is already parked or its booking can't be used now
router.post("/entry", timeGate("entry"), async (req, res) => {
  res.status(201).json(await entry.captureEntry(req.user, req.body));
});

// POST /api/tickets/scan {qrCode} -> the session {sessionId, entryTime, slotNumber, plateNumber, status, ...}
// 400 if the code isn't a valid entry ticket
router.post("/tickets/scan", async (req, res) => {
  res.json(await entry.scanTicket(req.body?.qrCode));
});

// POST /api/exit {gateId, sessionId | qrCode | plateNumber}
// -> {sessionId, entryTime, exitTime, duration, amount, paid, paymentStatus: CONFIRMED|NOT_REQUIRED} and the barrier opens
// 402 PAYMENT_REQUIRED {amount (still due), total, paid, duration, paymentStatus: UNPAID|PENDING} until confirmed
// payments cover the fee; 400 invalid fields or ticket, 404 unknown gate or session, 409 already left
router.post("/exit", timeGate("exit"), async (req, res) => {
  res.json(await exit.processExit(req.user, req.body));
});

// GET /api/receipts/:id -> {number, plateNumber, entryTime, exitTime, duration, chargedHours, ratePerHour, amount, payments, ...}
// staff: any receipt; drivers: their own (404 otherwise)
router.get("/receipts/:id", async (req, res) => {
  res.json(await receipts.getReceipt(req.user, req.params.id));
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

// GET /api/gates/status?facilityId -> {gates:[{id, name, type, facilityId, online, queued, lastDeliveredAt}]}
// online: the last command reached the gate controller; queued: commands waiting for the link to return
router.get("/gates/status", async (req, res) => {
  res.json({ gates: await gates.gateStatus(req.query) });
});

// GET /api/gates/overrides?facilityId -> {logs:[{event: MANUAL_OVERRIDE, actorId, actorEmail, details, at}]} latest first
router.get("/gates/overrides", async (req, res) => {
  res.json({ logs: await gates.recentOverrides(req.query) });
});

// POST /api/gates/:id/override {action: OPEN|CLOSE, reason, note?}
// -> {gateId, action, delivered, online, queued, logId}. Audited as MANUAL_OVERRIDE. If the gate's
// controller can't be reached, the command is queued and retried (delivered: false).
router.post("/gates/:id/override", async (req, res) => {
  res.json(await gates.overrideGate(req.user, req.params.id, req.body));
});

module.exports = router;
