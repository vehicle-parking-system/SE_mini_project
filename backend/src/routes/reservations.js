// Online pre-booking (VPS-F-020 to VPS-F-023). Drivers book and see their own bookings;
// admins can look up and cancel any booking (see permissions.js).
const express = require("express");
const reservations = require("../reservations");

const router = express.Router();

// POST /api/reservations {vehicleId, facilityId, zoneId?, slotId?, startTime, endTime}
// -> 201 {reservationId, slotId, slotNumber, status: HELD, holdExpiresAt, qrCode, ...}
// 400 invalid fields, 404 unknown facility/zone/slot, 409 no free slot or the vehicle is already booked,
// 422 window in the past, too far ahead or outside opening hours
router.post("/", async (req, res) => {
  res.status(201).json(await reservations.createReservation(req.user, req.body));
});

// GET /api/reservations -> {reservations:[...]} the driver's bookings, latest first
router.get("/", async (req, res) => {
  res.json({ reservations: await reservations.listReservations(req.user) });
});

// GET /api/reservations/:id -> {reservationId, status: HELD|CONFIRMED|EXPIRED|CANCELLED|REFUNDED, ...}
router.get("/:id", async (req, res) => {
  res.json(await reservations.getReservation(req.user, req.params.id));
});

// POST /api/reservations/:id/cancel -> the cancelled reservation; 409 if it can't be cancelled
router.post("/:id/cancel", async (req, res) => {
  res.json(await reservations.cancelReservation(req.user, req.params.id));
});

module.exports = router;
