# Defect retest and Sprint 3 close, 16 November 2026

Tester: Daruru Bhuvan Sai (QA Lead). Build: browser retest on `main` @ `c54412a` (after PRs #20, #21, #22, #26, #27, #28, #29). Automated run on `main` @ `722d27b` plus the VPS-50 fix (PR #31), the final code.
Environment: macOS arm64, Node 24, disposable MongoDB 7, API on `http://localhost:4000`, Vite dev server, `seed-demo.js` facilities, sandbox payment gateway. Accounts are test-only.

## Automated run (`scripts/verify-part3.cjs --disposable-db`)

| Stage | Result | File |
|---|---|---|
| Isolated unit tests | 7 suites, 90/90 pass | `unit-results.json` |
| Backend integration and API tests | 27 suites, 305/305 pass, 0 skipped, 0 `MaxListenersExceededWarning` | `backend-results.json` |
| API acceptance over HTTP | 9 suites, 50/50 pass | `acceptance-results.json` |
| Coverage, all 64 source files | lines 93.55%, statements 91.21%, functions 92.49%, branches 83.63% | `coverage-summary.json` |
| Gate benchmark, 20 lanes × 3 cycles | entry p90 89.6 ms, exit p90 36.7 ms, 0 failed (budget 3000 ms) | `gate-benchmark-summary.log` |
| Frontend production build | pass | `frontend-build.log` |

## Browser retest of the UI defects

| Defect | Steps | Result | Evidence |
|---|---|---|---|
| DEF-001 / VPS-47 (PR #27) | As admin on the Gate page: admit walk-in `KA09WK4747` (Manual), look up the plate at the exit, **Take card payment** | **PASS**: payment accepted, barrier opened, receipt VPS-2026-000001 for ₹30 | `03-VPS-47-admin-gate-payment-accepted.jpg` |
| DEF-002 / VPS-48 (PR #28) | Admin opens Reports, logs out; driver logs in | **PASS**: driver lands on their own profile; no "Not permitted". Router state on `/login` after logout is `null` | `01-VPS-48-driver-lands-on-own-profile.jpg` |
| DEF-003 / VPS-49 (PR #29) | Driver searches Airport Long-Stay, books P1-01, opens My bookings; read the accessibility tree | **PASS**: 10 Book buttons with 10 unique names, e.g. "Book slot P1-01, Zone P1, 20 m from the entrance"; booking buttons named "Pay ₹60 online for slot P1-01 at Airport Long-Stay" and "Cancel booking for slot P1-01 at Airport Long-Stay". Visible text unchanged | `02-VPS-49-bookings-buttons.jpg` |

## Defect found by CI after the merge: DEF-004 / VPS-50 (PR #31)

After the last merge, CI on `main` @ `722d27b` failed one acceptance test (TC-Sec-06, credential stuffing: 200 instead of 429). The login-throttle window document took its TTL expiry from the business clock, which the acceptance suite sets to 2 Nov, so MongoDB's TTL monitor (real clock) could delete the counter mid-test. Fixed by putting the expiry on the real clock; a unit test covers it. Forcing the TTL monitor to run every second reproduces it every time before the fix and never after: see `vps-50-ttl-repro.log` (0/15 vs 15/15).

`SHA256SUMS` lists a checksum for every file in this folder.
