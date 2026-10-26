// RBAC policy (VPS-SR-003): the one place that says which roles may call which
// endpoint. The authorize middleware checks every /api request against it before
// any route runs, so a module is protected from the moment its routes are added.
//
// Rules are matched in order; the first match wins. ":param" matches one path
// segment and a trailing "*" matches the rest. A request no rule matches is
// denied (default deny), so a new endpoint must be added here before it is reachable.
const DRIVER = "DRIVER";
const ATTENDANT = "ATTENDANT";
const ADMIN = "ADMIN";

const PUBLIC = "PUBLIC";
const STAFF = [ATTENDANT, ADMIN];
const ANY_USER = [DRIVER, ATTENDANT, ADMIN];

const RULES = [
  // Public
  ["GET", "/api/health", PUBLIC],
  ["POST", "/api/auth/register", PUBLIC],
  ["POST", "/api/auth/login", PUBLIC],
  ["POST", "/api/payments/webhook", PUBLIC], // authenticated by its HMAC signature instead
  ["*", "/api/test/*", PUBLIC], //              only mounted when NODE_ENV=test

  // Own account — vehicles belong to drivers only
  ["*", "/api/users/me/vehicles", [DRIVER]],
  ["*", "/api/users/me/vehicles/*", [DRIVER]],
  ["*", "/api/users/me", ANY_USER],
  ["*", "/api/users/me/*", ANY_USER],

  // Slot search & reservations (Driver Web App)
  ["GET", "/api/facilities", ANY_USER],
  ["GET", "/api/slots/available", [DRIVER]],
  ["POST", "/api/reservations", [DRIVER]],
  ["GET", "/api/reservations", [DRIVER]], //  the driver's own bookings
  ["GET", "/api/reservations/:id", [DRIVER, ADMIN]],
  ["POST", "/api/reservations/:id/cancel", [DRIVER, ADMIN]],

  // Gate operations (Attendant Kiosk / Hardware Abstraction Service)
  ["POST", "/api/entry", STAFF],
  ["POST", "/api/exit", STAFF],
  ["POST", "/api/tickets/scan", STAFF],
  ["GET", "/api/sessions/:id", STAFF],
  ["GET", "/api/slots/:id", STAFF],
  ["GET", "/api/occupancy/:facilityId", STAFF],
  ["GET", "/api/receipts/:id", ANY_USER],

  // Payments: drivers pay online, attendants take at-gate payments
  ["POST", "/api/payments", [DRIVER, ATTENDANT]],

  // Admin Console and reports
  ["*", "/api/admin/*", [ADMIN]],
  ["GET", "/api/reports/:type", [ADMIN]],
];

function compile(pattern) {
  const wildcard = pattern.endsWith("*");
  const body = (wildcard ? pattern.slice(0, -1) : pattern)
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body}${wildcard ? ".*" : "/?"}$`);
}

const COMPILED = RULES.map(([method, pattern, roles]) => ({ method, pattern, regex: compile(pattern), roles }));

// -> {pattern, roles} for the first matching rule, or null
function findRule(method, path) {
  if (method === "HEAD") method = "GET";
  const rule = COMPILED.find((r) => (r.method === "*" || r.method === method) && r.regex.test(path));
  return rule ? { pattern: rule.pattern, roles: rule.roles } : null;
}

module.exports = { PUBLIC, RULES, findRule };
