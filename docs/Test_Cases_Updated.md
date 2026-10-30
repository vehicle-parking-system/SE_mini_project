# Updated Test Case Document

Evidence generated: 30 October 2026, 23:31 IST. Baseline commit: 9ea6b597a8d51b4070b80182b056575b8c183aeb. Tests include the supplied working-tree changes.

This is an automated local verification record. It is not UAT sign-off or deployment certification. Simulated business dates in November are test inputs; execution dates are not backdated.

## Baseline and changes

The baseline is the linked Vehicle Parking System Test Plan v1.0 and existing automated scripts at the recorded source commit. The three attached TEST CASE PDFs are lecture references, not a prior project case document. Existing case IDs are preserved. Cases below describe the current sprint implementation; added manual cases are clearly identified.

Updates include explicit barrier override and audit assertions (TC-Admin-03), a corrected one-hour minimum in the fee test helper, current configuration/reporting/archival coverage, separate pure unit tests, lifecycle-safe test servers, and honest statuses for external checks. No undocumented sprint history is invented.

## Shared setup and test data

For automated API cases, seed tests/helpers/fixture.js into the disposable instance and set the business clock to 2026-11-02 10:00 Asia/Kolkata. Use seeded Driver, second Driver, Attendant and Admin tokens. Main Facility opens 06:00-23:00 and has occupied A-01, free car slots A-02/A-03, and bike slot A-B1. Small Facility has one car slot. Car rate is 40/hour, bike rate 20/hour; arrival grace is 15 minutes and refund cutoff 60 minutes. Each case resets its data. Passwords and gateway tokens are dummy test inputs.

Preconditions: installed Node dependencies, isolated MongoDB, a test-mode API, synthetic identities, and the named role for each operation. Manual/external cases require staging, devices and/or actual reviewers. Positive, negative, equivalence-class, boundary and concurrency techniques follow the teaching references.

## TC-Entry-01 - Capture entry

Requirement: VPS-F-001. Type: Automated / supporting local check.

Description and steps: Submit ANPR car, booked QR car and MANUAL bike entries at the fixture entry gate.

Expected result: Successful session with session ID, slot, entry time and ticket; session gate and supplied plate match.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/entry.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Entry-02 - Nearest slot and concurrency

Requirement: VPS-F-002. Type: Automated / supporting local check.

Description and steps: Enter a car with nearer/farther matching slots; race requests for the single-slot facility.

Expected result: Nearest eligible slot; exactly one successful allocation; no duplicated occupied slot.

Actual result: PASS. 2 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/entry.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Entry-03 - Facility full

Requirement: VPS-F-003. Type: Automated / supporting local check.

Description and steps: Fill the small facility then submit another car entry.

Expected result: 409; Facility Full display; no extra session and no OPEN command.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/entry.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Entry-04 - Entry ticket

Requirement: VPS-F-004. Type: Automated / supporting local check.

Description and steps: Enter a registered vehicle and scan its returned ticket.

Expected result: Scanned ticket resolves to the same session ID, entry time and slot number.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/entry.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Exit-01 - Fee boundaries

Requirement: VPS-F-010. Type: Automated / supporting local check.

Description and steps: Enter at 10:00 with rate 40/hour; advance clock for 30, 60, 61 and 165 minutes; request exit quote.

Expected result: Amounts follow started-hour rounding: 40, 40, 80, 120; fee calculated server-side.

Actual result: PASS. 4 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/exit.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Exit-02 - Payment before exit

Requirement: VPS-F-011. Type: Automated / supporting local check.

Description and steps: Attempt unpaid exit; create pending payment; confirm via signed webhook; retry exit.

Expected result: 402 while unpaid/pending; barrier stays closed; confirmed full payment permits exit.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/exit.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Exit-03 - Release slot

Requirement: VPS-F-012. Type: Automated / supporting local check.

Description and steps: Pay, exit and measure time to read slot availability.

Expected result: Slot AVAILABLE within 2 seconds of confirmed exit. Backend slotRelease tests separately verify reuse.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/exit.test.js; backend/test/slotRelease.api.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Exit-04 - Receipt

Requirement: VPS-F-013. Type: Automated / supporting local check.

Description and steps: Complete paid exit; retrieve returned receipt and session as attendant.

Expected result: Receipt entry/exit times match the session; duration matches exit; amount follows the 125-minute fee.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/exit.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Res-01 - Reserve an available slot

Requirement: VPS-F-020. Type: Automated / supporting local check.

Description and steps: Reserve 14:00-16:00 as Driver; search the same window afterwards.

Expected result: Reservation ID, slot ID, status and hold expiry returned; booked slot absent from search results.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/reservation.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Res-02 - Search and boundaries

Requirement: VPS-F-021. Type: Automated / supporting local check.

Description and steps: Search 14:00-16:00; insert overlap 15:00-17:00; search again and at 17:00; try past/closed windows.

Expected result: Only free matching slots, nearest first; back-to-back allowed; invalid windows 422.

Actual result: PASS. 2 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/slots.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Res-03 - Grace expiry

Requirement: VPS-F-022. Type: Automated / supporting local check.

Description and steps: Book a slot; advance test clock past its configured arrival grace; read availability.

Expected result: Hold expires and slot returns to availability; status EXPIRED.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/reservation.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Res-04 - Capacity and opening rules

Requirement: VPS-F-023. Type: Automated / supporting local check.

Description and steps: Book outside facility opening hours and contend for the last slot.

Expected result: 422 outside hours; capacity never oversold (409 when unavailable).

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/reservation.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Pay-01 - Online and gate payments

Requirement: VPS-F-030. Type: Automated / supporting local check.

Description and steps: Create driver ONLINE booking payment and attendant AT_GATE session payment; submit signed confirmations.

Expected result: Payment records retain gateway references; only confirmed payments settle the target.

Actual result: PASS. 2 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/payment.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Pay-02 - Cancellation refund

Requirement: VPS-F-031. Type: Automated / supporting local check.

Description and steps: Pay for a booking; cancel before or within the configured cutoff.

Expected result: Full refund before cutoff; no refund after cutoff; refund transaction is recorded.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/payment.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Pay-03 - Transaction history

Requirement: VPS-F-032. Type: Automated / supporting local check.

Description and steps: Create confirmed payment and cancellation refund; read admin transactions.

Expected result: At least two transaction records; every record has numeric amount and string status, gateway reference and creation time.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/payment.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Admin-01 - Configuration

Requirement: VPS-F-040. Type: Automated / supporting local check.

Description and steps: Create a facility/zone/slots; deactivate nearest fixture slot; enter a vehicle.

Expected result: Configuration accepted; inactive slot skipped and A-03 allocated.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/admin.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Admin-02 - Rate change

Requirement: VPS-F-041. Type: Automated / supporting local check.

Description and steps: Admin sets hourly rate 60; enter afterwards; advance two hours; quote exit.

Expected result: 120 due; backend tests also verify existing sessions retain entry-time rate.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/admin.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Admin-03 - Staff and override

Requirement: VPS-F-042. Type: Automated / supporting local check.

Description and steps: Create attendant; login; enter manually; POST exit-gate override OPEN with SCANNER_FAILURE; read audit log.

Expected result: ATTENDANT role; OPEN delivered; audit matches nested user.id, gate, action and reason.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/admin.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Admin-04 - Report exports

Requirement: VPS-F-043. Type: Automated / supporting local check.

Description and steps: Enter/pay/exit after 90 minutes at 40/hour; request revenue and all three CSV report types.

Expected result: Revenue total 80; each CSV returns 200, text/csv content type and more than one row. Backend report tests separately check detailed aggregates.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/api/admin.test.js; backend/test/reports.api.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Sec-01 - Sensitive-data review

Requirement: VPS-NF-003. Type: Automated / supporting local check.

Description and steps: Exercise login, entry and malformed payment; inspect database and captured backend log.

Expected result: No test passwords, JWTs or card numbers in logs; no raw PAN in database. Compliance certification remains outside this check.

Actual result: PASS. 2 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/security/security.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Sec-02 - TLS enforcement

Requirement: VPS-SR-001. Type: Automated / supporting local check.

Description and steps: Run backend TLS listener/config tests; separately scan a deployed HTTPS endpoint with testssl.sh and ZAP.

Expected result: Local listener accepts TLS 1.2/1.3 and refuses older versions when certificate tests execute; deployment scans still required.

Actual result: PARTIAL - local evidence only. See the System Validation Report for the unexecuted or partial scope.

Script / procedure: backend/test/tls.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Sec-03 - Password hashes

Requirement: VPS-SR-002. Type: Automated / supporting local check.

Description and steps: Register accounts sharing a test password; inspect MongoDB records.

Expected result: Salted bcrypt/argon2 hashes, different salts; no plaintext password.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/security/security.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Sec-04 - Role boundaries

Requirement: VPS-SR-003. Type: Automated / supporting local check.

Description and steps: Run Driver/Attendant/Admin endpoint matrix; alter JWT role; attempt self-registration as admin.

Expected result: Only allowed roles authorized; forged JWT refused; self-registration remains DRIVER.

Actual result: PASS. 4 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/security/security.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Sec-05 - Card data

Requirement: VPS-SR-004. Type: Automated / supporting local check.

Description and steps: Submit a sandbox token with a deliberately supplied test card number; inspect all DB collections.

Expected result: Raw card data rejected/not stored; only gateway references persist.

Actual result: PASS. 1 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/security/security.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Sec-06 - Lockout and throttling

Requirement: VPS-SR-005. Type: Automated / supporting local check.

Description and steps: Fail login 5 times; inspect audit/notifications; test parallel guesses, repeated locks, IP throttling and admin unlock.

Expected result: 423 locked; failures/alerts recorded; repeat duration increases; 429 for IP throttle; authorized unlock works.

Actual result: PASS. 6 recorded assertion(s); see evidence/acceptance-results.json and the assertion register.

Script / procedure: tests/security/security.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-OPS-01 - Archival and retention

Requirement: VPS-NF-004. Type: Automated / supporting local check.

Description and steps: Run archive integration tests with aged synthetic audit/access records; retrieve, tamper and expire archives.

Expected result: Archive/retrieval integrity and one-year retention floor enforced for synthetic timestamps; elapsed-year operation not measured.

Actual result: PASS (synthetic integration). See archive.api.test.js assertions in evidence/backend-results.json.

Script / procedure: backend/test/archive.api.test.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Perf-01 - Gate response budget

Requirement: VPS-NF-001. Type: Automated / supporting local check.

Description and steps: Run local benchmark with 20 lanes, 3 cycles, 1000 historical stays; review per-step p90 and failures.

Expected result: Entry and exit p90 <=3000 ms under this local workload; deployed 100-user JMeter run still required.

Actual result: FAIL - local response-time sample. See the System Validation Report for the unexecuted or partial scope.

Script / procedure: backend/scripts/bench-gate.js. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-Perf-02 - Tenfold scale

Requirement: VPS-NF-005. Type: Manual / external.

Description and steps: On staging run JMeter at baseline 100 then 1000 concurrent users on representative topology; compare latency/error/throughput.

Expected result: No correctness loss at 10x load; document actual topology and agreed acceptable performance.

Actual result: NOT RUN. See the System Validation Report for the unexecuted or partial scope.

Script / procedure: tests/performance/vps-load.jmx. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-UAT-01 - Driver usability and accessibility

Requirement: STP-5. Type: Manual / external.

Description and steps: In supported browsers register/login, find parking, book/pay, view ticket and receipt; use keyboard/screen reader.

Expected result: Tasks understandable and operable; labels/focus/contrast verified by real users; record observed results.

Actual result: NOT RUN. See the System Validation Report for the unexecuted or partial scope.

Script / procedure: Manual - NOT RUN. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-UAT-02 - Staff and admin UI

Requirement: STP-5. Type: Manual / external.

Description and steps: Use Gate/Monitor/Facilities/Security/Reports with staff roles; test denied pages and print ticket/receipt.

Expected result: UI follows authorized workflows; errors clear; output readable; obtain user feedback.

Actual result: NOT RUN. See the System Validation Report for the unexecuted or partial scope.

Script / procedure: Manual - NOT RUN. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-INT-01 - External integrations

Requirement: STP-6. Type: Manual / external.

Description and steps: On staging exercise real payment sandbox, notification delivery, printer/scanner and controller or vendor simulator.

Expected result: Signed payment confirmation, actual delivery/printing/scanning and safe gate behavior observed.

Actual result: NOT RUN. See the System Validation Report for the unexecuted or partial scope.

Script / procedure: External environment - NOT RUN. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## TC-OPS-02 - Monthly availability

Requirement: VPS-NF-002. Type: Manual / external.

Description and steps: Collect a complete month of reservation/payment monitoring including downtime; calculate uptime/total scheduled time.

Expected result: At least 99.5% monthly availability supported by monitoring records.

Actual result: NOT RUN. See the System Validation Report for the unexecuted or partial scope.

Script / procedure: Monitoring - NOT RUN. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.

## Assertion register

Every executed acceptance assertion, including tests without a case ID, is listed with its observed status. This register preserves parameterized test names.

| Script | Assertion | Actual |
|---|---|---|
| tests/security/security.test.js | Security TC-Sec-04 [VPS-SR-003]: RBAC matrix — each role can call only the functions permitted to it | PASSED |
| tests/security/security.test.js | Security TC-Sec-04 [VPS-SR-003]: a JWT whose role claim was edited is rejected | PASSED |
| tests/security/security.test.js | Security TC-Sec-04 [VPS-SR-003]: an admin-created attendant has the attendant role and is denied driver and admin functions | PASSED |
| tests/security/security.test.js | Security TC-Sec-04 [VPS-SR-003]: self-registration cannot create staff accounts | PASSED |
| tests/security/security.test.js | Security TC-Sec-06 [VPS-SR-005]: account locks after 5 failed logins and an alert is logged | PASSED |
| tests/security/security.test.js | Security TC-Sec-06 [VPS-SR-005]: each failed attempt is logged and the owner is notified of the lock | PASSED |
| tests/security/security.test.js | Security TC-Sec-06 [VPS-SR-005]: parallel guessing cannot get more than 5 password checks | PASSED |
| tests/security/security.test.js | Security TC-Sec-06 [VPS-SR-005]: a repeat lock lasts longer (15 min, then 1 hour) and admins are alerted | PASSED |
| tests/security/security.test.js | Security TC-Sec-06 [VPS-SR-005]: one client trying many accounts (credential stuffing) is throttled with 429 | PASSED |
| tests/security/security.test.js | Security TC-Sec-06 [VPS-SR-005]: an admin sees the locked account and can unlock it | PASSED |
| tests/security/security.test.js | Security — database review TC-Sec-03 [VPS-SR-002]: passwords are stored as salted bcrypt/argon2 hashes, never plaintext | PASSED |
| tests/security/security.test.js | Security — database review TC-Sec-05 [VPS-SR-004] / TC-Sec-01 [VPS-NF-003]: no card numbers are stored, only gateway tokens | PASSED |
| tests/security/security.test.js | Security — log review TC-Sec-01 [VPS-NF-003]: logs contain no passwords, tokens or card data | PASSED |
| tests/api/payment.test.js | Payment Processing TC-Pay-01 [VPS-F-030]: online payment for a reservation is confirmed only by the signed webhook | PASSED |
| tests/api/payment.test.js | Payment Processing TC-Pay-01 [VPS-F-030]: at-gate payment for a walk-in exit | PASSED |
| tests/api/payment.test.js | Payment Processing TC-Pay-02 [VPS-F-031]: refund inside the policy window, no refund outside it | PASSED |
| tests/api/payment.test.js | Payment Processing TC-Pay-03 [VPS-F-032]: every transaction is logged with the gateway reference | PASSED |
| tests/api/payment.test.js | Payment Processing Security §5.1: webhook with an invalid signature is rejected and changes nothing | PASSED |
| tests/api/payment.test.js | Payment Processing Security §5.1: replaying a valid webhook does not create a second payment | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation TC-Exit-01 [VPS-F-010]: fee for 30 minutes = duration × rate | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation TC-Exit-01 [VPS-F-010]: fee for 60 minutes = duration × rate | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation TC-Exit-01 [VPS-F-010]: fee for 61 minutes = duration × rate | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation TC-Exit-01 [VPS-F-010]: fee for 165 minutes = duration × rate | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation TC-Exit-02 [VPS-F-011]: barrier opens only after payment status = Confirmed | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation TC-Exit-03 [VPS-F-012]: slot is Available within 2 seconds of exit confirmation | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation TC-Exit-04 [VPS-F-013]: receipt fields match the session record | PASSED |
| tests/api/exit.test.js | Vehicle Exit & Fee Calculation API /api/exit: unknown session returns 404 | PASSED |
| tests/api/entry.test.js | Vehicle Entry & Slot Allocation TC-Entry-01 [VPS-F-001]: entry via ANPR, QR and manual input each creates a session | PASSED |
| tests/api/entry.test.js | Vehicle Entry & Slot Allocation TC-Entry-02 [VPS-F-002]: nearest free slot of the right type is allocated and locked | PASSED |
| tests/api/entry.test.js | Vehicle Entry & Slot Allocation TC-Entry-02 [VPS-F-002] concurrency: one free slot is never given to two vehicles | PASSED |
| tests/api/entry.test.js | Vehicle Entry & Slot Allocation TC-Entry-03 [VPS-F-003]: entry rejected with 'Facility Full' and barrier stays closed | PASSED |
| tests/api/entry.test.js | Vehicle Entry & Slot Allocation TC-Entry-04 [VPS-F-004]: entry ticket has session ID, entry time and slot, and scans at exit | PASSED |
| tests/api/entry.test.js | Vehicle Entry & Slot Allocation API /api/entry: invalid ticket returns 400 and the barrier stays closed | PASSED |
| tests/api/auth.test.js | Driver registration & login API /api/auth/register: a driver registers with a vehicle and can log in | PASSED |
| tests/api/auth.test.js | Driver registration & login API /api/auth/register: duplicate email or plate is rejected with 409, bad input with 400 | PASSED |
| tests/api/auth.test.js | Driver registration & login API /api/auth/login: wrong password returns 401 | PASSED |
| tests/api/auth.test.js | Driver registration & login API /api/users/me: a driver views and edits their profile and vehicles | PASSED |
| tests/api/auth.test.js | Driver registration & login API /api/users/me: requires a token | PASSED |
| tests/api/reservation.test.js | Slot Reservation / Online Pre-booking TC-Res-01 [VPS-F-020]: driver reserves a slot and it is not offered to others | PASSED |
| tests/api/reservation.test.js | Slot Reservation / Online Pre-booking TC-Res-03 [VPS-F-022]: hold is released after the grace period if the driver does not arrive | PASSED |
| tests/api/reservation.test.js | Slot Reservation / Online Pre-booking TC-Res-04 [VPS-F-023]: bookings over capacity (409) or outside operating hours (422) are rejected | PASSED |
| tests/api/reservation.test.js | Slot Reservation / Online Pre-booking API /api/reservations: booking without a token returns 401 | PASSED |
| tests/api/admin.test.js | Admin, Attendant & Reporting TC-Admin-01 [VPS-F-040]: admin configures a lot, zone and slots; a deactivated slot is never allocated | PASSED |
| tests/api/admin.test.js | Admin, Attendant & Reporting TC-Admin-02 [VPS-F-041]: a changed rate is used for later fee calculations | PASSED |
| tests/api/admin.test.js | Admin, Attendant & Reporting TC-Admin-03 [VPS-F-042]: new attendant performs a manual override, recorded in the audit log | PASSED |
| tests/api/admin.test.js | Admin, Attendant & Reporting TC-Admin-04 [VPS-F-043]: occupancy, revenue and usage reports match the data and export as CSV | PASSED |
| tests/api/slots.test.js | Real-Time Slot Search TC-Res-02 [VPS-F-021]: search lists only slots free for the whole window | PASSED |
| tests/api/slots.test.js | Real-Time Slot Search TC-Res-02 [VPS-F-021]: windows outside opening hours or in the past are rejected with 422 | PASSED |
| tests/api/slots.test.js | Real-Time Slot Search API /api/slots/available: a driver sees facilities and zones to search, staff can't search | PASSED |
| tests/api/hardware.test.js | Hardware resilience Risk: gate command is queued during network loss and executed once when the link returns | PASSED |
