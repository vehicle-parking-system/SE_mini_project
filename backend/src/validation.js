// Input validation for driver accounts and vehicles. Each validator returns the
// normalized value or throws a 400 listing every invalid field.
const { badRequest } = require("./errors");

const VEHICLE_TYPES = ["CAR", "BIKE", "TRUCK"];
const MAX_VEHICLES = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile number
const PLATE_RE = /^[A-Z0-9]{4,12}$/;

const isString = (v) => typeof v === "string";

function check(errors, field, ok, message) {
  if (!ok) errors[field] = message;
}

function fail(errors) {
  if (Object.keys(errors).length) throw badRequest("Some fields are invalid", errors);
}

const normalizeEmail = (email) => (isString(email) ? email.trim().toLowerCase() : "");
const normalizePhone = (phone) => (isString(phone) ? phone.replace(/[\s-]/g, "").replace(/^(\+91|0)/, "") : "");
const normalizePlate = (plate) => (isString(plate) ? plate.replace(/[\s-]/g, "").toUpperCase() : "");

function nameErrors(errors, name) {
  check(errors, "name", isString(name) && name.trim().length >= 2 && name.trim().length <= 80,
    "Name must be 2–80 characters");
}

function phoneErrors(errors, phone) {
  check(errors, "phone", PHONE_RE.test(normalizePhone(phone)), "Enter a valid 10-digit mobile number");
}

function passwordErrors(errors, password, field = "password") {
  check(errors, field, isString(password) && password.length >= 8 && password.length <= 128
    && /[A-Za-z]/.test(password) && /\d/.test(password),
    "Password must be at least 8 characters and contain a letter and a number");
}

function vehicleErrors(errors, vehicle, field = "vehicle") {
  if (!vehicle || typeof vehicle !== "object") return check(errors, field, false, "Vehicle details are required");
  check(errors, `${field}.plateNumber`, PLATE_RE.test(normalizePlate(vehicle.plateNumber)),
    "Enter a valid number plate, e.g. KA01AB1234");
  check(errors, `${field}.vehicleType`, VEHICLE_TYPES.includes(vehicle.vehicleType),
    `Vehicle type must be one of ${VEHICLE_TYPES.join(", ")}`);
}

const cleanVehicle = (v) => ({ plateNumber: normalizePlate(v.plateNumber), vehicleType: v.vehicleType });

function validateRegistration(body = {}) {
  const errors = {};
  nameErrors(errors, body.name);
  check(errors, "email", EMAIL_RE.test(normalizeEmail(body.email)) && body.email.length <= 254, "Enter a valid email address");
  phoneErrors(errors, body.phone);
  passwordErrors(errors, body.password);

  const vehicles = body.vehicles ?? [];
  if (!Array.isArray(vehicles) || vehicles.length > MAX_VEHICLES) {
    check(errors, "vehicles", false, `Add at most ${MAX_VEHICLES} vehicles`);
  } else {
    vehicles.forEach((v, i) => vehicleErrors(errors, v, `vehicles[${i}]`));
    const plates = vehicles.map((v) => normalizePlate(v?.plateNumber));
    check(errors, "vehicles", new Set(plates).size === plates.length, "The same number plate was entered twice");
  }
  fail(errors);

  return {
    name: body.name.trim(),
    email: normalizeEmail(body.email),
    phone: normalizePhone(body.phone),
    password: body.password,
    vehicles: vehicles.map(cleanVehicle),
  };
}

// POST /api/admin/attendants {name, email, password, phone?}
function validateStaffAccount(body = {}) {
  const errors = {};
  nameErrors(errors, body.name);
  check(errors, "email", EMAIL_RE.test(normalizeEmail(body.email)) && body.email.length <= 254, "Enter a valid email address");
  passwordErrors(errors, body.password);
  if (body.phone !== undefined && body.phone !== "") phoneErrors(errors, body.phone);
  fail(errors);
  return {
    name: body.name.trim(),
    email: normalizeEmail(body.email),
    password: body.password,
    ...(body.phone && { phone: normalizePhone(body.phone) }),
  };
}

function validateLogin(body = {}) {
  const errors = {};
  check(errors, "email", isString(body.email) && body.email.trim() !== "", "Email is required");
  check(errors, "password", isString(body.password) && body.password !== "", "Password is required");
  fail(errors);
  return { email: normalizeEmail(body.email), password: body.password };
}

// PATCH /api/users/me: only the fields present are changed.
function validateProfileUpdate(body = {}) {
  const errors = {};
  const update = {};
  if (body.name !== undefined) { nameErrors(errors, body.name); update.name = isString(body.name) && body.name.trim(); }
  if (body.phone !== undefined) { phoneErrors(errors, body.phone); update.phone = normalizePhone(body.phone); }
  if (!Object.keys(update).length && !Object.keys(errors).length) errors.body = "Nothing to update";
  fail(errors);
  return update;
}

function validatePasswordChange(body = {}) {
  const errors = {};
  check(errors, "currentPassword", isString(body.currentPassword) && body.currentPassword !== "", "Current password is required");
  passwordErrors(errors, body.newPassword, "newPassword");
  fail(errors);
  return { currentPassword: body.currentPassword, newPassword: body.newPassword };
}

function validateVehicle(body = {}) {
  const errors = {};
  vehicleErrors(errors, body);
  fail(errors);
  return cleanVehicle(body);
}

module.exports = {
  VEHICLE_TYPES, MAX_VEHICLES, validateRegistration, validateStaffAccount, validateLogin, validateProfileUpdate,
  validatePasswordChange, validateVehicle,
};
