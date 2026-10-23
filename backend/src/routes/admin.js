// Admin Console endpoints. Only ADMIN can reach /api/admin/* (see permissions.js).
const express = require("express");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const clock = require("../clock");
const logger = require("../logger");
const { createAccount } = require("../accounts");
const { validateStaffAccount } = require("../validation");

const router = express.Router();

// GET /api/admin/audit-logs?event=ACCESS_DENIED -> {logs:[{event, actorId, details, at}]}
router.get("/audit-logs", async (req, res) => {
  const filter = typeof req.query.event === "string" ? { event: req.query.event } : {};
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

module.exports = router;
