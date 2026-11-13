# Sprint 3 Test Closure Report

| | |
|---|---|
| Project | Vehicle Parking System (VPS) |
| Prepared by | Daruru Bhuvan Sai, QA Lead |
| Date | 13 November 2026 |
| Jira | VPS-46 (closure), VPS-41 … VPS-45, defects VPS-47 … VPS-49 |
| Test Plan | Vehicle_Parking_System_Test_Plan.docx v2.0 (Docs repository) |
| Build verified | `main` @ `e1b1c88` + PR #20 (VPS-41) + PR #21 (VPS-43), merged locally as `badf585` |
| Evidence | [`evidence/closure-2026-11-13/`](evidence/closure-2026-11-13/) (raw Jest JSON, logs, coverage summary, run manifest, `SHA256SUMS`), [`evidence/gate-benchmark-retest.log`](evidence/gate-benchmark-retest.log), [`evidence/uat/`](evidence/uat/) |

This report closes Sprint 3 testing. It supersedes the statuses in the generated `Requirements_Traceability_Matrix.md` (30 Oct) where they differ, and every change is backed by evidence from the 13 Nov runs. The Part-3 evidence from 30 Oct is kept unchanged for history.

## 1. Summary

**Recommendation: ready for the final demo, with three known UI defects and four checks that need a deployed environment.** Every automated test passes. The one recorded FAIL (gate latency) does not reproduce on a clean environment, and the listener-leak observation was a test-setup bug that is now fixed. The UI walkthrough found three defects in existing code. None blocks a core use case, and each has a workaround.

| Measure | Part-3 (30 Oct) | Closure (13 Nov) |
|---|---|---|
| Backend suites / tests | 23 / 265 | **27 / 303**, 0 failed, 0 skipped |
| Isolated unit tests (no DB) | 3 suites | **7 suites / 89 tests** |
| API acceptance (HTTP against a running server) | pass | **9 suites / 50 tests**, 0 failed |
| Frontend production build | pass | pass (338 ms) |
| Line / statement / function / branch coverage, all 64 source files | 92.61 / 89.83 / 92.09 / **80.53**% | 93.54 / 91.21 / 92.49 / **83.63**% |
| MaxListenersExceededWarning in test logs | present (OBS-001) | **0** |
| Gate benchmark 20 lanes, entry p90 | 4376.7 ms (FAIL) | **84.3 ms** (PASS) |
| Verifier steps (unit, backend, coverage-scope, benchmark, acceptance, build) | all exit 0 | all exit 0 |

## 2. Work done in Sprint 3 testing

| Jira | Work | Outcome |
|---|---|---|
| VPS-41 | Root-caused OBS-001 (MaxListenersExceededWarning). supertest called `listen()` once per in-flight request on a shared, non-listening server during 25/30-request bursts. Four suites now start one listening server in `beforeAll` | Fixed, retested: 0 warnings. PR #20 |
| VPS-42 | Retested the TC-Perf-01 FAIL on a clean disposable MongoDB at the original load and at 10× | Not reproducible: entry p90 91 ms (20 lanes), 79 ms (50 lanes, 20k past stays), 0 failures. Closed as an environment artefact of the earlier host |
| VPS-43 | Risk-based branch review (S3-05): 38 unit tests for production startup guards, gate metrics, config cache and login throttle. Mutation-checked | Branch coverage +3.1 points; the four modules 50-72% → 92-100%. PR #21 |
| VPS-44 | UI walkthrough of `feature/ui-refresh` as driver, admin and attendant, with accessibility checks | 10 flows pass; 3 defects (all pre-existing on `main`); no regressions from the branch. [UAT_Report.md](UAT_Report.md) |
| VPS-45 | PR checklist, bug report and test case request forms | PR #22 |
| VPS-46 | Deviations from SRS/SAD, this report, Test Plan v2.0 and SRS v1.1 traceability update | [Design_Deviations.md](Design_Deviations.md), Docs repository PR |

## 3. Final traceability and status

PASS = every expected result observed. PARTIAL = executed locally but part of the expected result needs an environment we don't have. NOT RUN = cannot be executed yet.

| Requirement | Test case | 30 Oct | **13 Nov** | Evidence / note |
|---|---|---|---|---|
| VPS-F-001 … F-004 | TC-Entry-01 … 04 | PASS | **PASS** | acceptance-results.json; UI walkthrough |
| VPS-F-010 … F-013 | TC-Exit-01 … 04 | PASS | **PASS** | acceptance-results.json; UI walkthrough (₹30 fee, barrier held until paid, receipt, immediate release) |
| VPS-F-020 … F-023 | TC-Res-01 … 04 | PASS | **PASS** | acceptance-results.json; UI booking |
| VPS-F-030 … F-032 | TC-Pay-01 … 03 | PASS | **PASS** | acceptance-results.json; at-gate sandbox payment in UI |
| VPS-F-040 … F-043 | TC-Admin-01 … 04 | PASS | **PASS** | acceptance-results.json; DEF-001 affects only the admin taking at-gate payment |
| VPS-NF-003 | TC-Sec-01 | PASS | **PASS** | |
| VPS-SR-001 | TC-Sec-02 | PARTIAL | **PARTIAL** | TLS 1.2+ and production guards tested locally (tls.test.js, config.test.js). The deployed testssl.sh scan needs `STAGING_URL` |
| VPS-SR-002 … SR-005 | TC-Sec-03 … 06 | PASS | **PASS** | lockout, throttle and RBAC also covered by the new unit tests |
| VPS-NF-004 | TC-OPS-01 | PASS (synthetic) | **PASS (synthetic)** | a full elapsed year can't be observed |
| VPS-NF-001 | TC-Perf-01 | FAIL | **PASS (local)** | gate-benchmark-retest.log; the deployed 100-user JMeter run is still recommended |
| VPS-NF-005 | TC-Perf-02 | NOT RUN | **PARTIAL** | 5 → 50 lanes (10×): 0 failures, entry p90 15.9 → 79.2 ms. A multi-instance topology was not run, and live events/metrics are per-process (Design_Deviations D-06) |
| STP-5 | TC-UAT-01 (driver) | NOT RUN | **PARTIAL** | QA walkthrough passed; DEF-003 open; real-user/screen-reader session pending |
| STP-5 | TC-UAT-02 (staff/admin) | NOT RUN | **PARTIAL** | QA walkthrough passed; DEF-001, DEF-002 open |
| STP-6 | TC-INT-01 | NOT RUN | NOT RUN | real gateway sandbox, SMS/email, devices not available (D-02…D-04) |
| VPS-NF-002 | TC-OPS-02 | NOT RUN | NOT RUN | needs a month of production monitoring |

**Totals (32 cases):** 26 PASS · 4 PARTIAL · 2 NOT RUN · 0 FAIL. Executed: 30 / 32 (93.8%). Requirement coverage: every SRS requirement has at least one executed case except VPS-NF-002.

## 4. Defects

| ID | Type | Severity | Status | Jira / PR |
|---|---|---|---|---|
| QA-001 … QA-006 | Test harness / reporting | — | Fixed in Part-3 | see Defect_Register.md |
| OBS-001 | Test harness | Minor | **Fixed and retested** | VPS-41, PR #20 |
| QA-007 (TC-Perf-01 FAIL) | Performance sample | — | **Not reproducible, closed** | VPS-42 |
| DEF-001 | Product: RBAC/UI mismatch | Major | Open | VPS-47, issue #23 |
| DEF-002 | Product: login redirect | Minor | Open | VPS-48, issue #24 |
| DEF-003 | Product: accessibility | Minor | Open | VPS-49, issue #25 |

Product defect density: 3 defects / 5.7 KLOC (non-blank, non-comment JS/JSX in `backend/src` and `frontend/src`) ≈ **0.53 per KLOC**. All three were found by UI testing, none by the automated API suites. That points to the UI as the least-tested layer, which is why the walkthrough was worth running.

## 5. Risks and open items

| Item | Risk | Action |
|---|---|---|
| No staging deployment | Nightly JMeter, testssl.sh and ZAP have nothing to run against (the workflow passes as a no-op) | Deploy once and set `STAGING_URL`; the workflow is ready |
| DEF-001 at the demo | An admin running a gate can't take payment | Demo exits as an attendant, or fix first |
| Horizontal scale (D-06) | Live updates don't cross instances | Redis pub/sub before running more than one API instance |
| General API rate limiting (D-05) | Only login is limited | Rate limit at the load balancer |
| Real-user UAT | Usability judged by the QA lead only | 2–3 users per role and one screen-reader session |

## 6. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| QA Lead | Daruru Bhuvan Sai | Testing complete for Sprint 3; ready for demo with the open items above | 13-11-2026 |
| Product Owner | Anirudh G Achar | Pending | |

## 7. How to reproduce

```sh
docker run -d --name vps-mongo -p 27017:27017 mongo:7      # disposable database
npm ci --prefix backend && npm ci --prefix tests && npm ci --prefix frontend
MONGO_URL=mongodb://127.0.0.1:27017/vps_part3 node scripts/verify-part3.cjs --disposable-db
MONGO_URL=mongodb://127.0.0.1:27017/vps_bench node backend/scripts/bench-gate.js 50 10 20000
```
