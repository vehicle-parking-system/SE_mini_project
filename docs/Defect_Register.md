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
