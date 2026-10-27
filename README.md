# Vehicle Parking System

MERN implementation of the [SRS/SAD](https://github.com/vehicle-parking-system/Docs).

| Folder | What |
|---|---|
| `backend/` | Node.js / Express REST API with MongoDB |
| `frontend/` | React (Vite) Driver Web App |
| `tests/` | Acceptance tests from the Software Test Plan (see [tests/README.md](tests/README.md)) |

## Implemented so far

**Driver Registration & Login.** A driver can register with their vehicles, log in, view and edit their profile, change their password, and add or remove vehicles.

| Endpoint | |
|---|---|
| `POST /api/auth/register` | `{name, email, phone, password, vehicles:[{plateNumber, vehicleType}]}` → `201 {token, user, vehicles}`. Returns 400 with per-field `details` or 409 if the email or plate is taken |
| `POST /api/auth/login` | `{email, password}` → `{token, user}`. Returns 401 for a wrong email or password, 423 while the account is locked, or 429 when the client's IP is throttled |
| `GET /api/users/me` | `{user, vehicles}` |
| `PATCH /api/users/me` | `{name?, phone?}` |
| `POST /api/users/me/password` | `{currentPassword, newPassword}` → 204 |
| `POST /api/users/me/vehicles` | `{plateNumber, vehicleType: CAR\|BIKE\|TRUCK}` → 201 |
| `DELETE /api/users/me/vehicles/:id` | 204 |
| `GET /api/admin/audit-logs?event=` | Admin only |
| `POST /api/admin/attendants` | Admin only. `{name, email, password, phone?}` → `201 {user}` with role ATTENDANT |
| `GET /api/admin/attendants` | Admin only. Lists attendant accounts |
| `GET /api/admin/locked-accounts` | Admin only. Accounts that are locked now, with their failure count and last failed or successful login |
| `POST /api/admin/users/:id/unlock` | Admin only. Ends a lock early → 204, or 404 if the account isn't locked |
| `GET /api/facilities` | Any logged-in user. Facilities with their opening hours and zones; staff also get their `gates` |
| `GET /api/slots/available` | Drivers only. `?facilityId&zoneId?&vehicleType&startTime&endTime` → free slots, nearest first |
| `POST /api/reservations` | Drivers only. `{vehicleId, facilityId, zoneId?, slotId?, startTime, endTime}` → `201 {reservationId, slotId, slotNumber, status: HELD, holdExpiresAt, qrCode, …}`. 409 if no slot is free or the vehicle is already booked, 422 for a window that breaks the search rules |
| `GET /api/reservations` | Drivers only. Their bookings, latest first |
| `GET /api/reservations/:id` | The driver's own booking, or any booking for an admin |
| `POST /api/reservations/:id/cancel` | Driver (own) or admin. A held or confirmed booking becomes `CANCELLED`; 409 otherwise |
| `POST /api/entry` | Staff. `{gateId, source: ANPR\|QR\|MANUAL, plateNumber \| qrCode, vehicleType?}` → `201` session. 400 for invalid fields or an invalid ticket, 409 if no slot is free, the vehicle is already inside, or the booking can't be used now |
| `GET /api/sessions` | Staff. `?facilityId&status=ACTIVE\|CLOSED` → parking sessions, latest first |
| `GET /api/slots/:id` | Staff. A slot's live status: `AVAILABLE`, `OCCUPIED`, `RESERVED` or `INACTIVE` |
| `POST /api/exit` | Staff. `{gateId, sessionId \| qrCode \| plateNumber}` → `{duration, amount, paid, paymentStatus: CONFIRMED}` and the barrier opens, or `402 {amount (still due), total, paid, paymentStatus: UNPAID\|PENDING}` until confirmed payments cover the fee. 400 for invalid fields or ticket, 404 for an unknown gate or session, 409 if the vehicle already left or is at another facility |
| `POST /api/payments` | Driver (`ONLINE`, own session or booking) or attendant (`AT_GATE`, sessions). `{sessionId \| reservationId, method, gatewayToken}` → `201 {paymentId, amount, status: PENDING, gatewayRef}`. The amount is what's owed now, or the booking's price; 409 if nothing is owed |
| `POST /api/payments/webhook` | Public, authenticated by its signature. `{paymentId, status: CONFIRMED\|FAILED}` with `x-razorpay-signature` (hex HMAC-SHA256 of the raw body with `PAYMENT_WEBHOOK_SECRET`). 401 for a bad signature; a replayed event is ignored |
| `GET /api/payments/:id` | A payment's status (drivers: their own) |
| `GET /api/admin/transactions` | Admin only. `?type=PAYMENT\|REFUND&from&to` → every payment and refund with its `gatewayRef` |
| `GET /api/receipts/:id` | Staff (any) or the driver (own). `{number, plateNumber, entryTime, exitTime, duration, chargedHours, ratePerHour, amount, payments}` |
| `GET /api/users/me/receipts` | The user's exit receipts, latest first |
| `GET /api/events` | Any logged-in user. `?facilityId` → `text/event-stream` of live `slot` and `availability` events |
| `POST /api/tickets/scan` | Staff. `{qrCode}` → the session the entry ticket belongs to; 400 "Invalid ticket" otherwise |
| `GET /api/users/me/sessions` | The parking sessions of the user's registered vehicles; an active one carries its `ticketQr` |
| `GET /api/occupancy/:facilityId` | Staff. `{capacity, occupied, booked, free, full, byVehicleType, byZone}` (inactive slots excluded) |
| `GET /api/sessions/:id` | Staff. `{sessionId, plateNumber, gateId, slotId, slotNumber, entryTime, exitTime, status, reservationId, …}` |
| `GET /api/reports/:type` | Admin only. `occupancy\|revenue\|usage`, `?facilityId&from&to&format=json\|csv` (local dates, inclusive, default today, at most 366 days) → `{type, facility, from, to, totals, days:[…]}`, or a CSV attachment with a row per day and a TOTAL row |
| `GET /api/gates/status` | Staff. `?facilityId` → `{gates:[{id, name, type, online, queued, lastDeliveredAt}]}` |
| `POST /api/gates/:id/override` | Staff. `{action: OPEN\|CLOSE, reason, note?}` → `{gateId, action, delivered, online, queued}`. Audited as `MANUAL_OVERRIDE` |
| `GET /api/gates/overrides` | Staff. `?facilityId` → the latest 50 `MANUAL_OVERRIDE` entries, for the shift log |
| `GET /api/admin/metrics/gates` | Admin only. `{budgetMs: 3000, targetPct: 90, entry:{count, p50, p90, p99, max, overBudget, withinBudgetPct, meetsTarget}, exit:{…}}` over this instance's latest 2000 of each |
| `GET /api/admin/facilities` | Admin only. Every facility with its settings, gates, zones, slots (`active`, live `status`) and rates. `GET /api/admin/facilities/:id` for one |
| `POST /api/admin/facilities` | Admin only. `{name, openTime, closeTime, address?, timezone?, reservationGraceMinutes?, refundCutoffMinutes?, gates?, zones?:[{name, slots:[{number, vehicleType, distance?}]}]}` → `201 {facility}` |
| `PATCH /api/admin/facilities/:id` | Admin only. Any of the facility's settings → `{facility}` |
| `POST /api/admin/facilities/:id/zones` | Admin only. `{name, slots?}` → `201 {zone}`; 409 if the name is taken |
| `POST /api/admin/facilities/:id/gates` | Admin only. `{name, type: ENTRY\|EXIT}` → `201 {gate}`. `PATCH /api/admin/gates/:id {name}` renames one |
| `POST /api/admin/zones/:id/slots` | Admin only. `{slots:[{number, vehicleType, distance?}]}` → `201 {slots}`; 409 if a number already exists in the facility. `PATCH /api/admin/zones/:id {name}` renames the zone |
| `PATCH /api/admin/slots/:id` | Admin only. `{number?, vehicleType?, distance?, active?}` → `{slot}`; 409 when deactivating or retyping a slot someone is parked in or has booked |
| `PUT /api/admin/rates` | Admin only. `{facilityId, zoneId?, vehicleType, ratePerHour}` → `{rate, created}`. `GET /api/admin/rates?facilityId` lists them, `DELETE /api/admin/rates/:id` removes one |

**Role-Based Access Control (VPS-SR-003).** [`backend/src/permissions.js`](backend/src/permissions.js) is the single policy table that lists which roles may call each endpoint, including modules that haven't been built yet. The `authorize` middleware checks every `/api` request against it before any route runs:

- An endpoint with no rule is denied (404), so a new endpoint must be added to the policy before it can be reached.
- A missing or invalid token gets 401. The role is read from the database, so an edited token, or a token issued before a role change, is rejected.
- A role that isn't permitted gets 403, and the denial is recorded as an `ACCESS_DENIED` audit entry.

| Role | Can use |
|---|---|
| Driver | Own profile and vehicles, slot search, reservations, online payment, receipts |
| Attendant | Own profile, gate entry and exit, ticket scan, sessions, slot status, occupancy, gate status and manual override, at-gate payment, receipts |
| Admin | Everything under `/api/admin/*`, reports, reservation lookup and cancellation, gate operations |

**Login Security & Account Lockout (VPS-SR-005).** In `backend/src/auth.js`:

- **Every attempt is tracked.** Each failure writes a `LOGIN_FAILED` audit entry with the reason (`WRONG_PASSWORD` with the attempt number, or `UNKNOWN_EMAIL`) and the client IP. It also updates `failedLoginAttempts` and `lastFailedLoginAt` on the account.
- **5 consecutive failures** (`MAX_FAILED_LOGINS`) lock the account. The lock writes an `ACCOUNT_LOCKED` audit entry, raises an `ALERT` warning in the log, and sends notifications to the account owner and to every admin.
- **Repeat offenders are locked for longer.** The first lock lasts 15 minutes, the next 1 hour, and every lock after that 24 hours (`LOCK_SCHEDULE_MINUTES`, default `15,60,1440`). A successful login or an admin unlock resets this.
- **A successful login resets the failure count**, so only consecutive failures count. When a lock expires, the failure count starts over.
- **Per-IP throttling stops credential stuffing** (one client trying passwords across many accounts). Each IP gets 20 login attempts that don't succeed per 15-minute window (`LOGIN_IP_MAX_FAILURES`, `LOGIN_IP_WINDOW_MINUTES`). After that, every login from it gets 429 with a `Retry-After` header and never reaches an account. A successful login doesn't use up an attempt. The first refusal in a window writes a `LOGIN_RATE_LIMITED` audit entry and alerts the admins. Counters are kept in MongoDB, so the limit holds across server instances.
- **While locked, the password isn't checked at all.** Login returns 423 with `lockedUntil`, and the attempt is recorded as `LOGIN_BLOCKED`.
- **Parallel guessing doesn't help.** Each attempt reserves one of the 5 allowed attempts in a single atomic database update before the password is checked. However many requests arrive at once, at most 5 passwords are checked, and the account locks exactly once.
- **Unknown emails** take the same time and get the same 401 as a wrong password, so the response doesn't reveal which emails are registered. They never lock anything.
- **Admins** can see locked accounts (with how many times in a row each was locked) and recent login events, including throttled IPs, on the **Security** page of the web app. They can unlock an account early, and each unlock is audited as `ACCOUNT_UNLOCKED`.
- Set `TRUST_PROXY` (for example `1`) when running behind a load balancer, so the recorded IP is the client's.

There is no SMS or email gateway yet. Notifications are recorded in an outbox (readable through `GET /api/test/notifications` in test mode) and logged without the recipient's address.

Self-registration always creates a Driver. Attendants are created by an admin (the Staff page in the web app). The first admin is created at startup from `ADMIN_EMAIL` and `ADMIN_PASSWORD` (optional `ADMIN_NAME`). An existing non-admin account with that email is never promoted.

Security: passwords are stored as bcrypt hashes (VPS-SR-002). JWTs are HS256, and the role is re-checked against the database on every request (VPS-SR-003). Request bodies and tokens are never logged (VPS-NF-003).

**Real-Time Slot Search (VPS-F-021).** A driver picks a facility, optionally a zone, their vehicle and a time window on the **Find parking** page, and sees the slots that are free for the whole window, nearest to the entrance first. The results refresh every 30 seconds. The rules are in [`backend/src/slotSearch.js`](backend/src/slotSearch.js):

- A slot is listed only if it matches the vehicle type and isn't inactive or occupied right now. A parked vehicle has no known exit time, so an occupied slot isn't offered for any window.
- A slot is also excluded if a confirmed reservation, or a held one whose hold hasn't expired, overlaps any part of the window. Back-to-back windows don't overlap. Booking reservations is the next story; search already respects them.
- The window must not have started (5 minutes' grace), must be at most 30 days ahead, and must fall within one day's opening hours. Opening hours are checked in the facility's time zone, so a browser in another time zone gets the same answer. Times need an explicit offset, for example `2026-11-02T14:00:00+05:30`.
- Invalid fields get 400 with per-field `details`, an unknown facility or zone gets 404, and a window that breaks the rules gets 422 with an explanation.

**Online Pre-Booking & Atomic Slot Locking (VPS-F-020, VPS-F-022, VPS-F-023).** A driver books any slot from the search results (or lets the system pick the nearest free one) for one of their vehicles, and finds it under **My bookings** with a QR code for the entry gate. The rules are in [`backend/src/reservations.js`](backend/src/reservations.js):

- The window follows the same rules as search (422), and the slot must fit the vehicle's type. One vehicle can't hold two overlapping bookings (409).
- **Atomic slot locking.** Every slot has a `version`. A booking reads it, checks that no active reservation overlaps the window, inserts its reservation, and then bumps the version only if it hasn't changed. If another request touched the slot in between, the bump fails, the reservation is withdrawn and the slot is checked again. So of any number of simultaneous requests for the last slot, exactly one gets it and the rest get 409. This works on a standalone MongoDB, with no transactions.
- **Holds.** A new booking is `HELD`: the slot is kept until the facility's grace period (`reservationGraceMinutes`, 15 by default) after the start time. If the driver hasn't arrived by then, the hold lapses: search offers the slot again and the booking becomes `EXPIRED`. Lapsed holds are expired whenever bookings are read and by a sweep every minute.
- **QR codes.** The code is `VPS1.R.<id>.<signature>`, an HMAC signed with `QR_SECRET` (derived from `JWT_SECRET` if unset). It can't be guessed or edited to point at another booking. Codes are computed when shown, not stored.
- Drivers see only their own bookings. Admins can look up and cancel any booking, and each admin cancellation is audited as `RESERVATION_CANCELLED`.

**Capture Vehicle Entry (VPS-F-001).** The ANPR camera, the QR scanner or an attendant on the **Gate** page reports a vehicle at an entry gate (`POST /api/entry`). The rules are in [`backend/src/entry.js`](backend/src/entry.js):

- **QR:** the booking's signed code checks the vehicle in to its booked slot, and the booking becomes `CHECKED_IN`. An invalid or altered code gets 400 "Invalid ticket". A booking for another facility, or one that is too early (more than 30 minutes before its start), expired or already used, gets 409.
- **ANPR / manual:** the plate is normalized. If it belongs to a registered vehicle that has a booking here for now, that booking is used. Otherwise the vehicle is a walk-in. An unknown plate needs a `vehicleType`.
- **Nearest-slot allocation (VPS-F-002).** A walk-in gets the free slot of its vehicle type nearest to the entrance (lowest `distance`), across all zones. Inactive slots are never used. Slots booked for any time before closing today are skipped too, since nobody knows when a walk-in will leave. Allocation uses the same slot `version` as booking: candidates' versions are read before checking for bookings, and a slot is taken only if its version is unchanged. Simultaneous entries never share a slot, and an entry racing a booking for the last slot leaves exactly one of them with it.
- **Facility full (VPS-F-003).** If no slot can be given to the vehicle, entry is refused with 409 `FACILITY_FULL`. The gate display shows "Facility Full", the barrier stays closed, and no session or occupancy changes. A booked vehicle still gets in to its held slot when the rest are full, and a full car section doesn't stop a bike. The Gate page shows live occupancy per vehicle type (parked, booked for now, free) so attendants can see the facility filling up.
- **Entry ticket (VPS-F-004).** Every entry returns a `ticketQr`: a signed `VPS1.T.<sessionId>.<signature>` code (see `qr.js`). The Gate page shows the ticket and can print it. A registered driver also gets it digitally: an `ENTRY_TICKET` notification, and under **Parked now** on My bookings. `POST /api/tickets/scan` reads a ticket back to its session at the exit.
- A plate can be inside only once (409), enforced by a unique index on active sessions, so simultaneous requests can't create two sessions.
- The **Hardware Abstraction Service** ([`backend/src/hardware.js`](backend/src/hardware.js)) is the only code that drives gates. On success the display shows where to go ("Proceed to slot A-02 · Zone A · 20 m") and the barrier opens. On any refusal the display shows the reason and the barrier stays closed. No gate controller is wired up yet, so a simulator records the commands (`GET /api/test/hardware/commands` in test mode). If a gate's controller can't be reached, its commands are queued and retried (see below).

**Parking Fee Calculation (VPS-F-010).** In [`backend/src/pricing.js`](backend/src/pricing.js):

- **Rate cards** give an hourly rate per vehicle type, either for one zone or facility-wide. A zone's own rate wins.
- The rate is looked up when the vehicle enters and **kept on its session**. A rate change therefore applies to vehicles that enter after it, never to one already parked. With no rate configured, parking is free and a warning is logged.
- **Fee = started hours × rate.** The duration runs from entry to the moment of calculation, rounded to the nearest minute, and every started hour is charged in full (30 min → 1 h, 61 min → 2 h). The first hour starts on entry, so at least one hour is charged. This is the rounding rule assumed in `tests/README.md`.
- At an exit gate (`POST /api/exit`), the vehicle is found by its session, its entry ticket or its plate. A parked vehicle's session also shows its `fee`: the total so far, what's paid and what's still due.

**Payment Verification before Exit (VPS-F-011).** In [`backend/src/payments.js`](backend/src/payments.js) and [`exit.js`](backend/src/exit.js):

- The attendant takes payment at the gate (**Take card payment** on the Gate page), or the driver pays online from their ticket on **My bookings**. A payment holds only the gateway's reference (`pay_…`), never the token or any card details.
- **A payment counts only once the gateway confirms it** with a webhook signed with `PAYMENT_WEBHOOK_SECRET`. A bad or missing signature gets 401 and changes nothing. Only a `PENDING` payment can change, so a replayed or late event is ignored.
- **The barrier opens only when confirmed payments cover the fee.** Until then the exit gets 402: `UNPAID`, or `PENDING` while a payment awaits confirmation, and the display shows "Please pay ₹…" or "Waiting for payment confirmation". Once paid, the session is closed (exit time, billed duration, amount) and the barrier opens, exactly once however many exit requests race.
- After paying, the driver has `EXIT_GRACE_MINUTES` (15) to leave before further time is charged.
- **Sandbox gateway.** No real gateway is connected yet. [`paymentGateway.js`](backend/src/paymentGateway.js) accepts any `tok_…` token. Outside tests it sends its own signed confirmation after a moment (`PAYMENT_SANDBOX_AUTOCONFIRM`), so the app works end to end. `tok_sandbox_decline` is declined.

**Real-time Slot Release on Exit (VPS-F-012).**

- When the exit is confirmed, the slot becomes `AVAILABLE` in the same request, before the response, and its version is bumped. The next vehicle at the entry can have it straight away.
- A booking the vehicle came in on becomes `COMPLETED`, so leaving early frees the slot for the rest of the booked window too.
- **Live events.** Every slot change (entry, exit, booking, cancellation) is published on an event bus ([`backend/src/events.js`](backend/src/events.js)) and pushed to open `GET /api/events` streams. The Gate page refreshes occupancy and the vehicle list as soon as anything changes at its facility, and a driver's search results update as soon as a slot is taken or freed. Both keep their 30-second refresh as a fallback.
- The stream is authenticated like every endpoint. The web app reads it with `fetch`, so the token travels in the `Authorization` header and never in a URL, and reconnects with backoff.
- The bus is in-process. With several API instances, publish through a shared broker such as Redis pub/sub instead.

**Secure Payment Tokenization (VPS-SR-004) and online payments (VPS-F-030 to VPS-F-032).**

- **Card data never enters the system.** The browser checkout or the card terminal gives card details to the gateway and gets a single-use `tok_…` token back. The API takes only that token, passes it to the gateway once and discards it, and stores the gateway's own reference (`pay_…`, `rfnd_…`).
- **Card data is refused.** [`middleware/cardData.js`](backend/src/middleware/cardData.js) runs before every route, including unauthenticated ones. It refuses with 400 `CARD_DATA_REJECTED` any body that has a card field (`cardNumber`, `cvv`, `expiry`, …) or a value that looks like a card number (13–19 digits, a card-scheme prefix, Luhn-valid). Refused data is never processed, stored or logged; the refusal is logged with its path only. The security tests check the database and the log for card numbers.
- **Paying for a booking.** A driver pays the booking's price (its window × the rate) online from **My bookings**. Once the gateway confirms, the booking is `CONFIRMED` and a `BOOKING_CONFIRMED` notification is sent. A payment that lands after the booking lapsed or was cancelled is refunded automatically. At the exit, the prepaid amount counts towards the fee, so only an overstay is charged.
- **Refund policy (VPS-F-031).** A paid booking cancelled at least the facility's `refundCutoffMinutes` (60) before its start is refunded in full and becomes `REFUNDED`. Later, it becomes `CANCELLED` with no refund. My bookings shows the free-cancellation deadline.
- **Transaction log (VPS-F-032).** Every payment and refund is a record with type, method, amount, status, gateway reference and time. Admins see them on the **Payments** page (`GET /api/admin/transactions`).

**Exit Receipt (VPS-F-013).** In [`backend/src/receipts.js`](backend/src/receipts.js):

- Every confirmed exit issues one receipt per session, numbered `VPS-<year>-<sequence>` from an atomic counter. The exit response carries its `receiptId`.
- A receipt is a fixed record of the stay: facility, plate, slot, entry and exit times, billed duration, charged hours × rate, the total, and each payment with its gateway reference. It never holds card data.
- **Printed:** the Gate page shows the receipt as soon as the barrier opens, with a Print button.
- **Digital:** a registered driver gets an `EXIT_RECEIPT` notification, a **Parking history** on My bookings, and a printable receipt page at `/receipts/:id`. Drivers can read only their own receipts.

**Occupancy Monitoring & Manual Gate Override (VPS-F-042).** The **Monitor** page, for attendants and admins, shows a facility's live occupancy per vehicle type and per zone, the connection to each of its gates, and the shift's manual overrides. The rules are in [`backend/src/gates.js`](backend/src/gates.js) and [`hardware.js`](backend/src/hardware.js):

- **Manual override.** When a camera, scanner, card terminal or barrier fails, an attendant opens or closes a barrier by hand (`POST /api/gates/:id/override`). A reason is required (`ANPR_FAILURE`, `SCANNER_FAILURE`, `BARRIER_FAULT`, `PAYMENT_TERMINAL_FAILURE`, `EMERGENCY`, or `OTHER` with a note).
- **Every override is audited** as `MANUAL_OVERRIDE`, with the attendant's id and email, the gate, the reason and whether the command reached the gate. A vehicle admitted on a plate the attendant typed in (`source: MANUAL`) is recorded the same way, with its session and plate. Admins see them all in the audit log; attendants see the latest on the Monitor page.
- **Network loss to a gate.** If a gate controller can't be reached, the session is still created and the command is queued for that gate. It is retried with exponential backoff (250 ms, doubling to 2 s) and delivered exactly once, in order, when the link is back. The Monitor page shows the gate as not connected, with the number of commands waiting. A command that hasn't gone through within `HARDWARE_QUEUE_TTL_SECONDS` (120) is dropped, so a barrier never opens long after the vehicle has gone. The attendant then uses an override.
- In test mode, `POST /api/test/hardware/link {gateId, up}` simulates the link going down and coming back.

**Entry/Exit Transaction Performance (VPS-NF-001).** An entry or exit must complete within 3 seconds for 90% of vehicles. What makes it fast:

- **One atomic claim per slot allocation.** Allocation reads the free slots' versions (lean, two fields), drops booked ones, then claims the nearest one whose version is unchanged in a single `findOneAndUpdate` over up to 50 candidates. Concurrent entries each get a different slot in one round trip, instead of all trying the nearest slot and working down the list one request at a time. The version check that keeps a racing booking safe is unchanged.
- **Cached configuration.** Gates, facilities and zones are read on every vehicle, so they're kept in a short-lived cache ([`cache.js`](backend/src/cache.js), `CONFIG_CACHE_SECONDS`, 30 by default, 0 turns it off). An admin change drops this instance's cache at once; other instances pick it up within the TTL.
- **Independent work runs side by side**: the plate lookup and the "already inside" check, the rate and the zone, the ticket and the driver's notification at entry; the slot release and the receipt at exit. Lapsed holds are expired for the gate's own facility only.
- **Measured all the time.** Every entry and exit is timed from request to response. One over 3 s is logged as `slow gate transaction`, and admins can read p50/p90/p99 and the share within budget from `GET /api/admin/metrics/gates`.
- **Benchmark.** `MONGO_URL=mongodb://localhost:27017/vps_bench npm run bench:gate -- [lanes] [cycles] [history]` runs the API in-process against a scratch database (which it drops) with a history of 20,000 past stays, and drives concurrent gate lanes through entry → at-gate payment → webhook → exit. On a laptop with a local MongoDB:

  | Lanes in parallel | Entry p90 before → after | Exit p90 before → after | Whole run before → after |
  |---|---|---|---|
  | 1 | 9 ms → 6 ms | 4 ms → 4 ms | 1.6 s → 1.2 s |
  | 50 | 328 ms → 141 ms | 163 ms → 111 ms | 5.1 s → 3.2 s |
  | 100 | 835 ms → 290–404 ms | 247 ms → 217 ms | 9.7 s → 6.3–6.5 s |

  At 100 lanes a single Node process is the limit (CPU-bound). More capacity comes from running more API instances (VPS-NF-005). The nightly JMeter run (TC-Perf-01) checks the 3 s target against a deployed environment.

**TLS 1.2+ Network Encryption (VPS-SR-001).** Every connection is encrypted with TLS 1.2 or later. The rules are in [`backend/src/transport.js`](backend/src/transport.js):

- **Client ↔ API**, one of two ways:
  - **The API terminates TLS itself.** Set `TLS_CERT_FILE` and `TLS_KEY_FILE` (and `TLS_CA_FILE` for intermediate certificates). The API serves HTTPS on `PORT`, accepts TLS 1.2 and 1.3 only, and for TLS 1.2 only forward-secret AEAD cipher suites (ECDHE with AES-GCM or ChaCha20). TLS 1.0 and 1.1 clients get a `protocol_version` alert. With `HTTP_REDIRECT_PORT` set, plain HTTP on that port is redirected (308) to HTTPS.
  - **A load balancer terminates TLS.** Set `TLS_TERMINATED_BY_PROXY=true` and `TRUST_PROXY`. A request the balancer received over plain HTTP is redirected to HTTPS if it is a GET or HEAD, and refused with 403 `HTTPS_REQUIRED` otherwise, because its body has already crossed the network unencrypted. `GET /api/health` is allowed over HTTP for the balancer's health checks. The balancer itself must be set to TLS 1.2+.
  - HTTPS responses carry `Strict-Transport-Security` (`HSTS_MAX_AGE_SECONDS`, 1 year by default).
- **API ↔ MongoDB and the payment gateway.** Node's minimum TLS version is pinned to 1.2 for every outgoing connection at startup. In production, a `MONGO_URL` for a remote host must turn TLS on (`tls=true`, or `mongodb+srv://`).
- **In production (`NODE_ENV=production`) the API refuses to start** without one of the two TLS set-ups, or with a remote database URL without TLS. Development and test mode still allow plain HTTP on `localhost`.
- The nightly workflow checks a deployed URL with testssl.sh (TC-Sec-02): nothing below TLS 1.2 is offered, and HTTP redirects to HTTPS.

**Revenue & Occupancy Reporting (VPS-F-043).** Admins pick a facility, a report and a date range on the **Reports** page and export it as CSV. The rules are in [`backend/src/reports.js`](backend/src/reports.js):

- A report has one row per day, in the facility's own time zone, and totals. The range is at most 366 days.
- **Revenue** counts money when it moved: a payment on the day the gateway confirmed it, a refund on the day it was processed. Each day has the payments received, refunds, net, and the split by method (at gate, online) and by what was paid for (parking, bookings). Pending and failed payments don't count.
- **Occupancy** is measured over each day's opening hours against the slots in use (inactive slots excluded): the average share of slots occupied, the peak number of vehicles parked at once, slot-hours used, entries and exits, and turnover (vehicles that entered per slot). A day still in progress counts up to now.
- **Usage**: entries by source (ANPR, QR, manual) and vehicle type, walk-ins vs bookings, average stay of the vehicles that left, the bookings for the day and how many were used, no-shows or cancelled, and entries per hour of day for the whole range.
- **CSV** has the same columns as the JSON days, a TOTAL row, and a file name like `revenue-main-lot-2026-11-01-to-2026-11-07.csv`. Text cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so a spreadsheet doesn't run them as formulas.

**Lot, Zone, Slot and Pricing Configuration (VPS-F-040, VPS-F-041).** Admins set up facilities on the **Facilities** page of the web app. The rules are in [`backend/src/configuration.js`](backend/src/configuration.js):

- A facility has a name, opening hours (closing must be after opening, since bookings fall within one day), a time zone, a booking grace period and a free-cancellation cut-off. A new facility gets one entry and one exit gate unless others are given; more gates and zones can be added later.
- **Slots** are added to a zone one by one or as a numbered run (A-04 … A-10, each a few metres further from the entrance). A slot number is unique within its facility.
- Facilities, zones, slots and gates are never deleted, because sessions, bookings and receipts refer to them. A slot that shouldn't be used is **deactivated**: search, booking and walk-in allocation skip it from that moment, and occupancy no longer counts it. It can be activated again.
- A slot is deactivated, or its vehicle type changed, only when nobody is parked in it and no active booking holds it (409 otherwise). The change uses the slot's `version` like booking and allocation do, so a booking racing it either lands first, and the change is refused, or is withdrawn.
- **Pricing rules.** A rate is an hourly price per vehicle type, for one zone or the whole facility. A zone's own rate wins. Setting a rate replaces the previous one for the same zone and vehicle type. A vehicle keeps the rate it entered with, so a change applies to vehicles that enter afterwards.
- Every change is recorded as a `CONFIG_CHANGED` audit entry with what changed (for a rate, the old and new price).

To try search with ready-made data, `npm run seed:demo` in `backend/` adds two demo facilities if none exist.

## Running locally

Requires Node 20+ and MongoDB.

```bash
# API on http://localhost:4000
cd backend && npm install
MONGO_URL=mongodb://localhost:27017/vps JWT_SECRET=change-me \
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change-me-123 npm start
MONGO_URL=mongodb://localhost:27017/vps npm run seed:demo   # demo facilities to search
npm test                       # set MONGO_URL to also run the DB-backed API tests

# Driver Web App on http://localhost:5173 (proxies /api to :4000)
cd frontend && npm install && npm run dev
```

To run the API over HTTPS locally, make a self-signed certificate and point the web app's proxy at it:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=localhost \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout key.pem -out cert.pem
TLS_CERT_FILE=cert.pem TLS_KEY_FILE=key.pem HTTP_REDIRECT_PORT=4080 npm start          # in backend/
VITE_API_PROXY=https://localhost:4000 VITE_API_PROXY_SELF_SIGNED=true npm run dev        # in frontend/
```
