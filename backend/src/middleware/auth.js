const { verifyToken } = require("../auth");
const User = require("../models/User");
const { unauthorized } = require("../errors");

// Requires a valid "Authorization: Bearer <jwt>" and loads req.user.
// The role is read from the database, not trusted from the token.
async function authenticate(req, _res, next) {
  const [scheme, token] = (req.get("authorization") || "").split(" ");
  if (scheme !== "Bearer" || !token) throw unauthorized();

  const claims = verifyToken(token);
  const user = await User.findById(claims.sub);
  if (!user || user.role !== claims.role) throw unauthorized("Your session is no longer valid. Please log in again.");
  req.user = user;
  next();
}

module.exports = { authenticate };
