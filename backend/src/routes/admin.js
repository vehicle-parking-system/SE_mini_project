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

const router = express.Router();

// GET /api/admin/audit-logs?event=ACCOUNT_LOCKED[,LOGIN_FAILED...] -> {logs:[{event, actorId, details, at}]}
router.get("/audit-logs", async (req, res) => {
  const filter = typeof req.query.event === "string" ? { event: { $in: req.query.event.split(",") } } : {};
  const logs = await AuditLog.find(filter).sort({ at: -1 }).limit(500);
  res.json({ logs: logs.map((l) => l.toPublic()) });
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

module.exports = router;
