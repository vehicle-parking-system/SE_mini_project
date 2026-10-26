// Profile and vehicle management for the logged-in user. Access is checked by the
// RBAC policy (permissions.js): any role may manage its profile, only drivers have vehicles.
const express = require("express");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const auth = require("../auth");
const { addVehicles } = require("../accounts");
const { sessionsForDriver } = require("../entry");
const { receiptsForDriver } = require("../receipts");
const { badRequest, conflict, notFound } = require("../errors");
const { MAX_VEHICLES, validateProfileUpdate, validatePasswordChange, validateVehicle } = require("../validation");

const router = express.Router();

async function profile(user) {
  const vehicles = await Vehicle.find({ owner: user._id }).sort({ createdAt: 1 });
  return { user: user.toPublic(), vehicles: vehicles.map((v) => v.toPublic()) };
}

// GET /api/users/me -> {user, vehicles}
router.get("/me", async (req, res) => {
  res.json(await profile(req.user));
});

// PATCH /api/users/me {name?, phone?} -> {user, vehicles}
router.patch("/me", async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user._id, validateProfileUpdate(req.body), { new: true });
  res.json(await profile(user));
});

// POST /api/users/me/password {currentPassword, newPassword} -> 204
router.post("/me/password", async (req, res) => {
  const { currentPassword, newPassword } = validatePasswordChange(req.body);
  if (!(await auth.comparePassword(currentPassword, req.user.passwordHash))) {
    throw badRequest("Current password is incorrect", { currentPassword: "Current password is incorrect" });
  }
  await User.updateOne({ _id: req.user._id }, { passwordHash: await auth.hashPassword(newPassword) });
  res.status(204).end();
});

// POST /api/users/me/vehicles {plateNumber, vehicleType} -> 201 {vehicle}
router.post("/me/vehicles", async (req, res) => {
  const vehicle = validateVehicle(req.body);
  if (await Vehicle.countDocuments({ owner: req.user._id }) >= MAX_VEHICLES) {
    throw conflict(`You can register at most ${MAX_VEHICLES} vehicles`);
  }
  const [created] = await addVehicles(req.user._id, [vehicle]);
  res.status(201).json({ vehicle: created.toPublic() });
});

// GET /api/users/me/sessions -> {sessions:[...]} parking sessions of the user's registered vehicles,
// latest first; an active one carries its entry ticket (ticketQr)
router.get("/me/sessions", async (req, res) => {
  res.json({ sessions: await sessionsForDriver(req.user) });
});

// GET /api/users/me/receipts -> {receipts:[...]} exit receipts for the user's vehicles, latest first
router.get("/me/receipts", async (req, res) => {
  res.json({ receipts: await receiptsForDriver(req.user) });
});

// DELETE /api/users/me/vehicles/:id -> 204
router.delete("/me/vehicles/:id", async (req, res) => {
  const { deletedCount } = await Vehicle.deleteOne({ _id: req.params.id, owner: req.user._id });
  if (!deletedCount) throw notFound("Vehicle not found");
  res.status(204).end();
});

module.exports = router;
