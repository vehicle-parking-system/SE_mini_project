# Defect and observation register

| ID | Observation and evidence | Disposition |
|---|---|---|
| QA-001 | Several database test describe blocks opened HTTP listeners during Jest discovery, even when MONGO_URL was unset. The initial no-database run completed assertions but stayed alive. | Fixed: listener creation moved into beforeAll in 14 suites. The no-database regression subsequently finished normally with intentional database skips; see evidence/no-db-regression.json and log. |
| QA-002 | The acceptance fee helper returned zero at zero minutes, while the implemented parking policy charges at least one started hour. | Fixed helper; isolated pricing suite explicitly covers zero and hour boundaries. |
| QA-003 | TC-Admin-03 only checked manual vehicle entry and a broad audit predicate; it did not directly invoke barrier override and referenced created.body.id instead of created.body.user.id. | Strengthened: invoke OPEN/SCANNER_FAILURE and check delivered command plus actor/gate/action/reason in the audit record. |
| QA-004 | Checked-in RTM contained stale partial/not-run counts for implemented admin/reporting modules and marked archive checks manual. | Replaced by evidence-derived current RTM with local archival integration distinguished from observed long-term retention. |
| OBS-001 | Backend test logs include MaxListenersExceededWarning during concurrent request testing. | Open observation: all relevant assertions completed; this warning alone does not establish a production memory leak. Investigate transient concurrent Supertest listeners before suppressing it. |
| GAP-001 | External security/load tests, actual devices/integrations, browser UAT/accessibility and monthly uptime are not evidenced locally. | Open validation work, not an inferred implementation defect. See System_Validation_Report.md and Sprint_3_Backlog.md. |

No product defect is claimed solely from a missing environment, coverage gap or test-harness warning. This register documents observed issues rather than inventing development-team history.

Additional performance observation: the final supplementary 20-lane sample completed 60 cycles with 0 failed cycles but entry p90 was 4376.7 ms (>3000 ms); exit p90 was 1572.0 ms. This is a FAIL for that local response-time sample, not a claim about production latency. The benchmark process exit code only indicates execution completed; measured budget must be assessed separately. Preserve this evidence and investigate host contention, database/HTTP latency and realistic deployed load before sign-off. See evidence/gate-benchmark.log.

QA-005: the report verifier originally inherited NODE_ENV=test for Vite. Corrected the verifier to explicitly use NODE_ENV=production and reran the frontend build. The final manifest retains the superseded build record and its reason; final frontend-build.log is the production result.

QA-006: the original Jest discovery roots only indexed test/ and its coverage map omitted unloaded server.js and routes/test.js. Corrected the coverage denominator using Istanbul zero-hit maps for both files; no execution was assumed. The future Jest configuration indexes the repository but explicitly selects test/**/*.test.js. A discovery-only check confirmed exactly the same 23 suites as the recorded passing run. Corrected totals: 92.61% lines, 89.83% statements, 92.09% functions and 80.53% branches across all 64 source files. See evidence/coverage-scope.json for before/after counts.

## Sprint 3 closure, 13 November 2026 (QA Lead: Daruru Bhuvan Sai)

| ID | Observation and evidence | Disposition |
|---|---|---|
| QA-007 | TC-Perf-01 local sample FAIL (entry p90 4376.7 ms > 3000 ms, 20 lanes × 3 cycles). | **Not reproducible; closed (VPS-42).** Same command on a clean disposable MongoDB 7: entry p90 91.1 ms, exit 36.3 ms, 0 failed; at 50 lanes × 10 cycles with 20,000 past stays entry p90 79.2 ms, exit 61.9 ms, 0 failed; the verifier run gave entry p90 84.3 ms. The earlier run took 15.1 s against 0.3 s now for identical work, which points to host contention. See evidence/gate-benchmark-retest.log and closure-2026-11-13/gate-benchmark-summary.log. A deployed JMeter run is still the final check. |
| DEF-001 | UI walkthrough: an admin on the Gate page gets 403 on "Take card payment"; POST /api/payments allows only DRIVER and ATTENDANT (permissions.js:53). Evidence: evidence/uat/08-DEF-001-admin-gate-payment-denied.jpg | **Open.** Major / High. Jira VPS-47, GitHub #23. |
| DEF-002 | UI walkthrough: after logout, the next user to log in is sent to the previous user's page and sees "Not permitted" (auth.jsx:67 → Login.jsx:22). Reproduced twice. Evidence: evidence/uat/05-DEF-002-login-redirect-not-permitted.jpg | **Open.** Minor / Medium. Jira VPS-48, GitHub #24. |
| DEF-003 | UI walkthrough: every slot-search result button is named "Book" (WCAG 2.4.6 / 2.5.3). | **Open.** Minor / Low. Jira VPS-49, GitHub #25. |

Closure totals: 6 harness/reporting issues and 1 observation fixed, 1 performance FAIL not reproducible, 3 product defects open (0 Critical, 1 Major with a workaround, 2 Minor). Details and release recommendation: Test_Closure_Report.md.
