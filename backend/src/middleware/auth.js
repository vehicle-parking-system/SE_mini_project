const { verifyToken } = require("../auth");
const clock = require("../clock");
const logger = require("../logger");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { PUBLIC, findRule } = require("../permissions");
const { unauthorized, forbidden, notFound } = require("../errors");

// Requires a valid "Authorization: Bearer <jwt>" and returns the user.
// The role is read from the database, not trusted from the token: a token
// issued before a role change stops working.
async function loadUser(req) {
  const [scheme, token] = (req.get("authorization") || "").split(" ");
  if (scheme !== "Bearer" || !token) throw unauthorized();

  const claims = verifyToken(token);
  const user = await User.findById(claims.sub);
  if (!user || user.role !== claims.role) throw unauthorized("Your session is no longer valid. Please log in again.");
  return user;
}

// RBAC gate for every /api request (VPS-SR-003), using the policy in permissions.js:
// unknown endpoint -> 404, no/invalid token -> 401, role not permitted -> 403 + ACCESS_DENIED audit entry.
async function authorize(req, _res, next) {
  const path = req.originalUrl.split("?")[0].toLowerCase();
  const rule = findRule(req.method, path);
  if (!rule) throw notFound("No such endpoint");
  if (rule.roles === PUBLIC) return next();

  req.user = await loadUser(req);
  if (!rule.roles.includes(req.user.role)) {
    await AuditLog.create({ event: "ACCESS_DENIED", actorId: req.user._id, at: clock.now(),
      details: { method: req.method, path, role: req.user.role } });
    logger.warn("access denied", { userId: req.user.id, role: req.user.role, method: req.method, path });
    throw forbidden();
  }
  next();
}

module.exports = { authorize };
