# Deviations from the SRS and SAD

| | |
|---|---|
| Compiled by | Daruru Bhuvan Sai (QA Lead), from a review of `main` against SRS v1.0 and SAD v1.0 |
| Date | 13 November 2026 |
| Code baseline | `main` @ `e1b1c88` (Sprint 2 freeze plus Part-3 test deliverables) |
| Jira | VPS-46 |

The checklist asks for every deviation from the original SRS/SAD to be documented for the demo. Each row below was checked in the code, not taken from memory. **Type**: *Decision* = a choice the documents left open, *Extension* = more than the documents asked for, *Limitation* = less than the documents describe, with the reason.

## Architecture and technology

| # | SRS / SAD says | Implemented | Type | Reason / impact |
|---|---|---|---|---|
| D-01 | SAD 3.6: Node/Express **or** Python Flask/Django | MERN only: React (Vite), Express 5, MongoDB via Mongoose 8, JWT | Decision | The team's skills and one codebase. The Flask variant is not built. |
| D-02 | SAD 3.3: Hardware Abstraction Service as a separate component | In-process module `backend/src/hardware.js` with a **simulator**; queuing with exponential backoff and a TTL as SAD 3.7 describes | Limitation | No gate hardware is available. The interface is isolated, so a real controller driver replaces the simulator only. |
| D-03 | SRS 3.3: Payment gateway (Razorpay/Stripe sandbox) | In-process sandbox `paymentGateway.js` that issues `pay_…` refs and sends Razorpay-style HMAC-signed webhooks to itself | Limitation | Real sandbox keys were not provisioned. The webhook signature checks are real and tested (TC-Pay-01). |
| D-04 | SRS 3.3: SMS/Email notification API | In-memory outbox (`notifications.js`); messages are logged without the recipient's address | Limitation | No SMS/email provider configured. Delivery is TC-INT-01, not run. |
| D-05 | SAD 3.9 STRIDE: DoS mitigated by rate limiting | Rate limiting on **login only** (per-IP throttle, VPS-SR-005). No general API rate limiter | Limitation | Expected at the load balancer/API gateway in deployment. Recommend adding one before production. |
| D-06 | SRS VPS-NF-005: scale to 10× users **without code changes** | Stateless JWT API; shared state in MongoDB (bookings, throttle, locks). **But** the live-event bus (`events.js`) and gate metrics (`metrics.js`) are per-process | Limitation | One instance passes 10× load (TC-Perf-02 local). With several instances, live slot updates need a shared broker such as Redis pub/sub, as the comment in `events.js` notes, and admin metrics are per instance. |
| D-07 | SAD 4.4: monitoring of transaction time | `GET /api/admin/metrics/gates`: p50/p90/p99 against the 3 s budget, warning log for any slow transaction | Extension | Lets admins check VPS-NF-001 directly. |
| D-08 | SRS VPS-NF-004: keep logs ≥ 1 year | Logs stay 90 days in MongoDB, then move to gzip files with SHA-256 checksums; retention 400 days; startup refuses < 365 | Decision | Keeps the database small while staying searchable (`GET /api/admin/logs` searches both). |
| D-09 | SRS VPS-SR-001: TLS 1.2+ | Either the API terminates TLS (`TLS_CERT_FILE`/`TLS_KEY_FILE`) or a proxy does (`TLS_TERMINATED_BY_PROXY` + `TRUST_PROXY`), with HSTS. **Production refuses to start without one**, and refuses a remote MongoDB URL without `tls=true` | Extension | Enforced in `config.js`; unit-tested (VPS-43). |
| D-10 | — | Live updates over Server-Sent Events (`GET /api/events`) for slot search and the gate occupancy board | Extension | Supports VPS-F-012 "immediately". |

## API design (SAD 4.3)

| # | SAD 4.3 | Implemented | Type |
|---|---|---|---|
| D-11 | `POST /api/reservations` → `{reservationId, slotId, status, holdExpiresAt}`; errors 401, 409, 422 | Same fields **plus** `slotNumber`, `qrCode`, price. Status starts as `HELD`. 409 also when the vehicle already has an overlapping booking | Extension |
| D-12 | `POST /api/entry` `{gateId, plateNumber \| qrCode, vehicleType}` | Also requires `source: ANPR\|QR\|MANUAL` so the audit log records how the vehicle was identified. Response is the session with `ticketQr` | Extension |
| D-13 | `POST /api/entry` errors 400, 409 | Also 409 "already inside" and "booking can't be used now" (outside the grace window) | Extension |
| D-14 | `POST /api/exit` `{gateId, sessionId}` | Accepts `sessionId`, `qrCode` **or** `plateNumber` (lost ticket) | Extension |
| D-15 | `POST /api/exit` → `{duration, amount, paymentStatus, receiptId}`; errors 402, 404 | Same fields plus `receiptNumber`, `chargedHours`, `ratePerHour`, `paid`, `slotReleased`. 402 carries the amount still due; also 400 (bad ticket) and 409 (already exited / wrong facility) | Extension |
| D-16 | Three endpoints specified | About 50 endpoints for auth, profile, admin configuration, reports, logs, archives, gates, payments and receipts, all listed in the root `README.md`, each behind one RBAC policy table (`permissions.js`, deny by default) | Extension |
| D-17 | Test Plan 6: Swagger API documentation | No Swagger/OpenAPI file. The API is documented in `README.md` and the HTTP paths in one place in `tests/contract.js` | Limitation |

## Business rules the SRS left open

| # | SRS | Implemented decision |
|---|---|---|
| D-18 | VPS-F-010 "within rounding rules" (not specified) | Charge per **started hour**, minimum one hour; duration rounded to the nearest minute. Covered in `pricing.test.js` |
| D-19 | — | After paying, a vehicle has `EXIT_GRACE_MINUTES` (15) to leave before extra time is charged |
| D-20 | VPS-F-022 "configurable grace period" | `reservationGraceMinutes` per facility (default 15). Unused bookings are released after it |
| D-21 | VPS-F-031 "refunds within policy" | Full refund when cancelled before `refundCutoffMinutes` (per facility); no refund after it |
| D-22 | VPS-SR-005 "lock after 5 failures" | Escalating locks of 15 min, 60 min, then 1 day; **plus** a per-IP throttle (20 failures per 15 min) against credential stuffing, with an admin alert once per window |
| D-23 | VPS-F-012 "within 2 s" | Slot released in the same request as the exit and pushed over SSE. Measured in the UI as immediate |

## Requirements without an SRS ID

| # | Item | Note |
|---|---|---|
| D-24 | Driver registration & login (Jira VPS-2) and RBAC (VPS-8) | Listed in SRS 2.2 major functions and VPS-SR-003, but registration has no `VPS-F-` row. Tested by `auth.api.test.js` and the UAT walkthrough |

## Known defects at closure

These are not design deviations. They are open defects from the 13 Nov UI walkthrough, tracked in `Defect_Register.md`, and should be mentioned honestly if they show up in the demo: DEF-001 (admin can't take at-gate payment), DEF-002 (login redirects to the previous user's page), DEF-003 (identical "Book" button names).
