// Admin Console endpoints. Only ADMIN can reach /api/admin/* (see permissions.js).
const express = require("express");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const clock = require("../clock");
const logger = require("../logger");
const { createAccount } = require("../accounts");
const { lockActive, unlockAccount } = require("../auth");
const { notFound } = require("../errors");
const { validateStaffAccount } = require("../validation");
const { listTransactions } = require("../payments");
const config = require("../configuration");
const metrics = require("../metrics");

const router = express.Router();

// GET /api/admin/audit-logs?event=ACCOUNT_LOCKED[,LOGIN_FAILED...] -> {logs:[{event, actorId, details, at}]}
router.get("/audit-logs", async (req, res) => {
  const filter = typeof req.query.event === "string" ? { event: { $in: req.query.event.split(",") } } : {};
  const logs = await AuditLog.find(filter).sort({ at: -1 }).limit(500);
  res.json({ logs: logs.map((l) => l.toPublic()) });
});

// GET /api/admin/transactions?type=PAYMENT|REFUND&from&to
// -> {transactions:[{paymentId, type, method, amount, status, gatewayRef, sessionId, reservationId, createdAt, ...}]}
// The transaction log (VPS-F-032): gateway references only, never card data.
router.get("/transactions", async (req, res) => {
  res.json({ transactions: await listTransactions(req.query) });
});

// POST /api/admin/attendants {name, email, password, phone?} -> 201 {user}
// Attendant accounts can only be created here; self-registration always makes a DRIVER.
router.post("/attendants", async (req, res) => {
  const { user } = await createAccount({ ...validateStaffAccount(req.body), role: "ATTENDANT" });
  await AuditLog.create({ event: "ATTENDANT_CREATED", actorId: req.user._id, at: clock.now(), details: { userId: user.id } });
  logger.info("attendant created", { userId: user.id, by: req.user.id });
  res.status(201).json({ user: user.toPublic() });
});

// GET /api/admin/attendants -> {users:[...]}
router.get("/attendants", async (_req, res) => {
  const users = await User.find({ role: "ATTENDANT" }).sort({ createdAt: -1 });
  res.json({ users: users.map((u) => u.toPublic()) });
});

// GET /api/admin/locked-accounts -> {users:[{...user, failedLoginAttempts, lockedUntil, lastFailedLoginAt, lastLoginAt}]}
router.get("/locked-accounts", async (_req, res) => {
  const users = await User.find(lockActive(clock.now())).sort({ lockedUntil: -1 });
  res.json({ users: users.map((u) => u.toSecurity()) });
});

// POST /api/admin/users/:id/unlock -> 204; 404 if the account isn't locked
router.post("/users/:id/unlock", async (req, res) => {
  if (!(await unlockAccount(req.params.id, req.user._id))) throw notFound("No locked account with that id");
  logger.info("account unlocked", { userId: req.params.id, by: req.user.id });
  res.status(204).end();
});

// GET /api/admin/metrics/gates -> {budgetMs, targetPct, entry:{count, p50, p90, p99, max, overBudget, withinBudgetPct,
// meetsTarget}, exit:{...}} over the latest gate transactions on this API instance (VPS-NF-001)
router.get("/metrics/gates", (_req, res) => {
  res.json(metrics.summary());
});

// Lot, zone, slot and pricing configuration (VPS-F-040, VPS-F-041); see configuration.js.
// A facility: {id, name, address, timezone, openTime, closeTime, reservationGraceMinutes, refundCutoffMinutes,
//   gates:[{id, name, type}], zones:[{id, name, slots:[{slotId, number, vehicleType, distance, status, active}]}], rates:[...]}

// GET /api/admin/facilities -> {facilities:[facility]}
router.get("/facilities", async (_req, res) => {
  res.json({ facilities: await config.listFacilities() });
});

// GET /api/admin/facilities/:id -> {facility}
router.get("/facilities/:id", async (req, res) => {
  res.json({ facility: await config.getFacility(req.params.id) });
});

// POST /api/admin/facilities {name, openTime, closeTime, address?, timezone?, reservationGraceMinutes?,
//   refundCutoffMinutes?, gates?:[{name?, type}], zones?:[{name, slots:[{number, vehicleType, distance?, active?}]}]}
// -> 201 {facility}. Without gates, the facility gets one entry and one exit gate.
router.post("/facilities", async (req, res) => {
  res.status(201).json({ facility: await config.addFacility(req.user, req.body) });
});

// PATCH /api/admin/facilities/:id {name?, address?, timezone?, openTime?, closeTime?, reservationGraceMinutes?,
//   refundCutoffMinutes?} -> {facility}
router.patch("/facilities/:id", async (req, res) => {
  res.json({ facility: await config.updateFacility(req.user, req.params.id, req.body) });
});

// POST /api/admin/facilities/:id/zones {name, slots?} -> 201 {zone}; 409 if the name is taken
router.post("/facilities/:id/zones", async (req, res) => {
  res.status(201).json({ zone: await config.addZone(req.user, req.params.id, req.body) });
});

// POST /api/admin/facilities/:id/gates {name, type: ENTRY|EXIT} -> 201 {gate}
router.post("/facilities/:id/gates", async (req, res) => {
  res.status(201).json({ gate: await config.addGate(req.user, req.params.id, req.body) });
});

// PATCH /api/admin/zones/:id {name} -> {zone}
router.patch("/zones/:id", async (req, res) => {
  res.json({ zone: await config.updateZone(req.user, req.params.id, req.body) });
});

// POST /api/admin/zones/:id/slots {slots:[{number, vehicleType, distance?, active?}]} -> 201 {slots}
// 409 if a slot number already exists in the facility
router.post("/zones/:id/slots", async (req, res) => {
  res.status(201).json({ slots: await config.addSlots(req.user, req.params.id, req.body) });
});

// PATCH /api/admin/slots/:id {number?, vehicleType?, distance?, active?} -> {slot}
// 409 when deactivating or retyping a slot someone is parked in or has booked
router.patch("/slots/:id", async (req, res) => {
  res.json({ slot: await config.updateSlot(req.user, req.params.id, req.body) });
});

// PATCH /api/admin/gates/:id {name} -> {gate}
router.patch("/gates/:id", async (req, res) => {
  res.json({ gate: await config.updateGate(req.user, req.params.id, req.body) });
});

// GET /api/admin/rates?facilityId -> {rates:[{id, facilityId, zoneId, vehicleType, ratePerHour, updatedAt}]}
router.get("/rates", async (req, res) => {
  res.json({ rates: await config.listRates(req.query) });
});

// PUT /api/admin/rates {facilityId, zoneId?, vehicleType, ratePerHour} -> {rate, created}
// No zoneId: the facility-wide rate. Applies to vehicles that enter from now on.
router.put("/rates", async (req, res) => {
  res.json(await config.setRate(req.user, req.body));
});

// DELETE /api/admin/rates/:id -> 204
router.delete("/rates/:id", async (req, res) => {
  await config.deleteRate(req.user, req.params.id);
  res.status(204).end();
});

module.exports = router;
