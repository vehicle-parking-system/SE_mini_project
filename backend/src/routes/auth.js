const express = require("express");
const auth = require("../auth");
const logger = require("../logger");
const { createAccount } = require("../accounts");
const { validateRegistration, validateLogin } = require("../validation");

const router = express.Router();

// POST /api/auth/register {name, email, phone, password, vehicles:[{plateNumber, vehicleType}]}
// Self-registration always creates a DRIVER.
router.post("/register", async (req, res) => {
  const input = validateRegistration(req.body);
  const { user, vehicles } = await createAccount({ ...input, role: "DRIVER" });
  logger.info("driver registered", { userId: user.id });
  res.status(201).json({
    token: auth.signToken(user),
    user: user.toPublic(),
    vehicles: vehicles.map((v) => v.toPublic()),
  });
});

// POST /api/auth/login {email, password} -> {token, user} | 401
router.post("/login", async (req, res) => {
  res.json(await auth.login(validateLogin(req.body)));
});

module.exports = router;
