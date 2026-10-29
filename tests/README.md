# Automated tests — Vehicle Parking System

Automated versions of the test cases in the [Software Test Plan](https://github.com/vehicle-parking-system/Docs). Each test's name starts with its test case ID and requirement, e.g. `TC-Exit-01 [VPS-F-010]`, so CI results map straight onto the RTM.

| Folder | What | Test cases | When it runs |
|---|---|---|---|
| `api/` | Entry, exit, reservation, payment, admin and hardware-resilience API tests (Jest) | TC-Entry-01–04, TC-Exit-01–04, TC-Res-01–04, TC-Pay-01–03, TC-Admin-01–04 | Every push / PR (`ci.yml`) |
| `security/` | RBAC matrix, lockout, password hashing, card-data and log review | TC-Sec-01, 03, 04, 05, 06 | Every push / PR (`ci.yml`) |
| `performance/` | JMeter load test and result checker | TC-Perf-01, TC-Perf-02 | Nightly / on demand (`nightly.yml`) |
| — | TLS scan (testssl.sh), OWASP ZAP baseline | TC-Sec-02 | Nightly / on demand (`nightly.yml`) |

TC-OPS-01 (log retention, VPS-NF-004) is covered by the backend's `test/archive.api.test.js`: archival, retrieval, integrity checks and the one-year retention floor. The monthly uptime reports for VPS-NF-002 stay manual.

## What CI does

On every push and pull request, `.github/workflows/ci.yml`:

1. Installs `frontend/` and runs its tests and build (once `frontend/` exists).
2. Installs `backend/` and runs its unit tests (`npm test`), then starts it with `NODE_ENV=test` and a fresh MongoDB.
3. Runs everything in `tests/` against it and writes the **Requirements Traceability Matrix** (pass/fail per requirement) to the run's summary page.
4. Fails the run, and so blocks the PR, if any test fails.

Until `backend/` exists, the API tests are reported as *not run* and the pipeline stays green.

Suites for modules that haven't been built yet are listed in [`pending.js`](pending.js). They are skipped and show as *not run* in the RTM, so they don't fail every PR. When a module is implemented, remove its line from `pending.js` in the same PR. From then on, its tests run and must pass. To run a pending suite while building it, set `RUN_PENDING=1`.

## What the backend must provide

The tests follow the API in SAD §4.3 (`/api/entry`, `/api/exit`, `/api/reservations` and their error codes). The other endpoints are assumptions, and **every path is listed in [`contract.js`](contract.js)**. If the backend uses different paths, change them there rather than in the tests.

The backend must also:

- **Be startable from `backend/`** with `npm ci && npm start`, listen on `PORT`, read `MONGO_URL`, `JWT_SECRET` and `PAYMENT_WEBHOOK_SECRET` from the environment, and answer `GET /api/health`.
- **Expose test hooks only when `NODE_ENV=test`** (see `contract.test` in `contract.js`):
  - `POST /api/test/reset`: wipe the DB, seed the fixture in [`helpers/fixture.js`](helpers/fixture.js), and return `{ids: {<fixture key>: <real id>}}`.
  - `POST /api/test/clock {now}`: make the server use this time, so durations and grace periods are testable.
  - `GET /api/test/hardware/commands` and `POST /api/test/hardware/link`: a simulated Hardware Abstraction Service that records gate commands and can simulate network loss.
  - `GET /api/test/notifications`: SMS/Email messages that would have been sent.
- **Verify payment webhooks** with a hex HMAC-SHA256 of the raw body in the `x-razorpay-signature` header.

## Assumptions to confirm

- **Fee rounding:** every started hour is charged (`expectedFee` in `helpers/fixture.js`). The SRS doesn't define the rule. The first hour starts on entry, so the backend charges at least one hour, which is why TC-Pay-01's at-gate payment straight after entry has something to pay.
- **Requirement mapping:** TC-Res-02–04 map to VPS-F-021–023, TC-Pay-01–03 to VPS-F-030–032 and TC-Admin-01–04 to VPS-F-040–043, in the order SRS §4.3–4.5 describes them.
- **TC-Entry-01 capacity:** the manual entry is a bike. Zone A has three car slots: A-01 starts occupied, and the test's own booking holds another. As first written, the third car entry could only succeed if a slot were given out twice.
- **Load:** the baseline is 100 concurrent users (`PERF_BASELINE_USERS`), and TC-Perf-02 uses 10× that.

## Running locally

```bash
cd tests && npm install
npm test                                   # without API_URL every suite is skipped
API_URL=http://localhost:4000 MONGO_URL=mongodb://localhost:27017/vps_test npm test
```

Set `BACKEND_LOG=<path to the backend's log file>` to include the TC-Sec-01 log review.

## Nightly performance & security

`.github/workflows/nightly.yml` runs against a deployed environment. Set these under **Settings → Secrets and variables → Actions**:

- **Variables:** `STAGING_URL`, `PERF_GATE_IN`, `PERF_GATE_OUT`, `PERF_BASELINE_USERS`
- **Secrets:** `PERF_ATTENDANT_EMAIL`, `PERF_ATTENDANT_PASSWORD`, `PAYMENT_WEBHOOK_SECRET`

Until `STAGING_URL` is set, the workflow does nothing. You can also start it by hand from the Actions tab with any URL.
