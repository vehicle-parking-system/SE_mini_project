// The API contract the automated tests are written against.
//
// /api/entry, /api/exit and /api/reservations (and their error codes) come from
// SAD §4.3. Everything else is an assumption made so the test plan could be
// automated before the backend exists. If the backend chooses a different path,
// change it HERE — the test files only reference these names.

module.exports = {
  health: "/api/health",

  // Auth & Access Control
  register: "/api/auth/register", // POST {name, email, phone, password, vehicles:[{plateNumber, vehicleType}]}
  login: "/api/auth/login", //       POST {email, password} -> {token, user:{id, role}} | 401 | 423 when locked
  //                                  | 429 + Retry-After when the client IP has too many failed logins
  //                                  register -> 201 {token, user, vehicles}; 400 invalid fields, 409 email or plate taken

  // Driver profile & vehicles (User & Vehicle Management)
  me: "/api/users/me", //                      GET -> {user, vehicles}; PATCH {name?, phone?} -> {user, vehicles}
  myPassword: "/api/users/me/password", //     POST {currentPassword, newPassword} -> 204
  myVehicles: "/api/users/me/vehicles", //     POST {plateNumber, vehicleType} -> 201 {vehicle}
  myVehicle: (id) => `/api/users/me/vehicles/${id}`, // DELETE -> 204

  // Reservation Management (SAD §4.3)
  facilities: "/api/facilities", //        GET -> {facilities:[{id, name, timezone, openTime, closeTime, zones:[{id, name}]}]}
  availableSlots: "/api/slots/available", // GET ?facilityId&zoneId?&vehicleType&startTime&endTime
  //                                          -> {slots:[{slotId, number, distance, zoneId, zoneName}], facility, window}
  //                                          nearest first; errors 400 invalid fields, 404 unknown facility/zone,
  //                                          422 window in the past, > 30 days ahead or outside opening hours
  reservations: "/api/reservations", //      POST {vehicleId, facilityId, zoneId, startTime, endTime}
  //                                          -> {reservationId, slotId, status, holdExpiresAt, qrCode}
  //                                          errors 401, 409 slot unavailable, 422 outside operating hours
  reservation: (id) => `/api/reservations/${id}`, // GET -> {status: HELD|CONFIRMED|EXPIRED|CANCELLED|REFUNDED, ...}
  cancelReservation: (id) => `/api/reservations/${id}/cancel`, // POST -> refund decided by refund policy

  // Entry / Exit Management (SAD §4.3). Called by the kiosk / HAS with an attendant token.
  entry: "/api/entry", // POST {gateId, plateNumber | qrCode, vehicleType, source: ANPR|QR|MANUAL}
  //                      -> {sessionId, slotNumber, slotId, entryTime, ticketQr}; errors 400 invalid ticket, 409 facility full
  exit: "/api/exit", //   POST {gateId, sessionId} -> {duration, amount, paymentStatus, receiptId}
  //                      errors 402 payment pending (body includes {amount}), 404 session not found
  session: (id) => `/api/sessions/${id}`, // GET -> {sessionId, plateNumber, gateId, entryTime, exitTime, slotId, status}
  ticketScan: "/api/tickets/scan", //        POST {qrCode} -> {sessionId, entryTime, slotNumber}
  receipt: (id) => `/api/receipts/${id}`, // GET -> {entryTime, exitTime, duration, amount}
  slot: (id) => `/api/slots/${id}`, //       GET -> {slotId, status: AVAILABLE|OCCUPIED|RESERVED|INACTIVE}
  occupancy: (facilityId) => `/api/occupancy/${facilityId}`, // GET -> {capacity, occupied}

  // Payment Processing
  payments: "/api/payments", // POST {sessionId | reservationId, method: ONLINE|AT_GATE, gatewayToken} -> {paymentId, status}
  paymentWebhook: "/api/payments/webhook", // POST signed body {paymentId, status: CONFIRMED|FAILED}
  webhookSignatureHeader: "x-razorpay-signature", // hex HMAC-SHA256 of the raw body with PAYMENT_WEBHOOK_SECRET
  transactions: "/api/admin/transactions", // GET -> {transactions:[{gatewayRef, amount, status, createdAt}]}

  // Admin, Attendant & Reporting
  adminFacilities: "/api/admin/facilities", // POST {name, openTime, closeTime, zones:[{name, slots:[{number, vehicleType, distance}]}]}
  adminSlot: (id) => `/api/admin/slots/${id}`, // PATCH {active:false}
  adminRates: "/api/admin/rates", // PUT {facilityId, zoneId, vehicleType, ratePerHour}
  adminAttendants: "/api/admin/attendants", // POST {name, email, password, phone?} -> 201 {user}; GET -> {users}
  auditLogs: "/api/admin/audit-logs", // GET ?event=MANUAL_OVERRIDE|ACCOUNT_LOCKED[,...] -> {logs:[{event, actorId, ...}]}
  lockedAccounts: "/api/admin/locked-accounts", // GET -> {users:[{id, email, failedLoginAttempts, lockedUntil, ...}]}
  unlockUser: (id) => `/api/admin/users/${id}/unlock`, // POST -> 204; 404 if not locked
  report: (type) => `/api/reports/${type}`, // GET occupancy|revenue|usage ?facilityId&from&to&format=json|csv

  // Test-support hooks. The backend must expose these ONLY when NODE_ENV=test.
  test: {
    reset: "/api/test/reset", //                     POST fixture -> {ids:{...}}  wipes the DB and seeds it
    clock: "/api/test/clock", //                     POST {now: ISO string}       sets the server clock
    hardwareCommands: "/api/test/hardware/commands", // GET -> {commands:[{gateId, command: OPEN|CLOSE|DISPLAY, message, at}]}
    hardwareLink: "/api/test/hardware/link", //      POST {gateId, up: boolean}  simulates gate network loss
    notifications: "/api/test/notifications", //     GET -> {notifications:[{to, channel, type}]}
    reservations: "/api/test/reservations", //       POST {slotId, startTime, endTime, status?, holdExpiresAt?} inserts a reservation
  },

  // Mongo collections inspected directly by the security tests.
  collections: { users: "users", passwordField: "passwordHash" },
};
