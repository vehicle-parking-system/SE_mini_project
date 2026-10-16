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

  // Reservation Management (SAD §4.3)
  availableSlots: "/api/slots/available", // GET ?facilityId&zoneId&vehicleType&startTime&endTime -> {slots:[{slotId}]}
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
  adminAttendants: "/api/admin/attendants", // POST {name, email, password}
  auditLogs: "/api/admin/audit-logs", // GET ?event=MANUAL_OVERRIDE|ACCOUNT_LOCKED -> {logs:[{event, actorId, ...}]}
  report: (type) => `/api/reports/${type}`, // GET occupancy|revenue|usage ?facilityId&from&to&format=json|csv

  // Test-support hooks. The backend must expose these ONLY when NODE_ENV=test.
  test: {
    reset: "/api/test/reset", //                     POST fixture -> {ids:{...}}  wipes the DB and seeds it
    clock: "/api/test/clock", //                     POST {now: ISO string}       sets the server clock
    hardwareCommands: "/api/test/hardware/commands", // GET -> {commands:[{gateId, command: OPEN|CLOSE|DISPLAY, message, at}]}
    hardwareLink: "/api/test/hardware/link", //      POST {gateId, up: boolean}  simulates gate network loss
    notifications: "/api/test/notifications", //     GET -> {notifications:[{to, channel, type}]}
  },

  // Mongo collections inspected directly by the security tests.
  collections: { users: "users", passwordField: "passwordHash" },
};
