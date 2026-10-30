# System Validation Report

Evidence generated: 30 October 2026, 23:31 IST. Baseline commit: 9ea6b597a8d51b4070b80182b056575b8c183aeb. Tests include the supplied working-tree changes.

This is an automated local verification record. It is not UAT sign-off or deployment certification. Simulated business dates in November are test inputs; execution dates are not backdated.

## Executed scope

External HTTP API/security acceptance: **50 passed / 0 failed / 0 skipped / 50 total** across 9 suites. Backend unit/integration/TLS combined: **265 passed / 0 failed / 0 skipped / 265 total** across 23 suites. The frontend production build is a compilation check, not a browser test.

MongoDB is a real temporary local database process. Gates, payment confirmations and notifications use project simulators, signed test webhooks and a notification outbox. Reset hooks are enabled only in test mode.

## Local performance observation

The supplementary benchmark used 20 concurrent gate lanes, three cycles per lane, 1000 historical stays and 600 slots. It is a short single-instance local run, not the deployed 100/1000-user JMeter experiment.

| Step | Samples | p50 ms | p90 ms | p99 ms |
|---|---|---|---|---|
| Entry | 60 | 1454.1 | 4376.7 | 4617.8 |
| Payment | 60 | 833.9 | 1265.5 | 1295.6 |
| Webhook | 60 | 334.3 | 372.2 | 567.0 |
| Exit | 60 | 1284.3 | 1572.0 | 1809.1 |

Observed failed cycles: 0. Raw evidence: evidence/gate-benchmark.log.

**The local response-time budget was missed.** Zero failed cycles does not mean the latency requirement passed. This short local measurement is sensitive to machine contention and does not establish deployed capacity, but it must be investigated rather than replaced with a better sample. The benchmark program reports measurements and returns success for execution; its process exit code is not a performance-budget assertion.

## Requirement traceability

| Case | Requirement | Outcome |
|---|---|---|
| TC-Entry-01 | VPS-F-001 | PASS |
| TC-Entry-02 | VPS-F-002 | PASS |
| TC-Entry-03 | VPS-F-003 | PASS |
| TC-Entry-04 | VPS-F-004 | PASS |
| TC-Exit-01 | VPS-F-010 | PASS |
| TC-Exit-02 | VPS-F-011 | PASS |
| TC-Exit-03 | VPS-F-012 | PASS |
| TC-Exit-04 | VPS-F-013 | PASS |
| TC-Res-01 | VPS-F-020 | PASS |
| TC-Res-02 | VPS-F-021 | PASS |
| TC-Res-03 | VPS-F-022 | PASS |
| TC-Res-04 | VPS-F-023 | PASS |
| TC-Pay-01 | VPS-F-030 | PASS |
| TC-Pay-02 | VPS-F-031 | PASS |
| TC-Pay-03 | VPS-F-032 | PASS |
| TC-Admin-01 | VPS-F-040 | PASS |
| TC-Admin-02 | VPS-F-041 | PASS |
| TC-Admin-03 | VPS-F-042 | PASS |
| TC-Admin-04 | VPS-F-043 | PASS |
| TC-Sec-01 | VPS-NF-003 | PASS |
| TC-Sec-02 | VPS-SR-001 | PARTIAL - local evidence only |
| TC-Sec-03 | VPS-SR-002 | PASS |
| TC-Sec-04 | VPS-SR-003 | PASS |
| TC-Sec-05 | VPS-SR-004 | PASS |
| TC-Sec-06 | VPS-SR-005 | PASS |
| TC-OPS-01 | VPS-NF-004 | PASS (synthetic integration) |
| TC-Perf-01 | VPS-NF-001 | FAIL - local response-time sample |
| TC-Perf-02 | VPS-NF-005 | NOT RUN |
| TC-UAT-01 | STP-5 | NOT RUN |
| TC-UAT-02 | STP-5 | NOT RUN |
| TC-INT-01 | STP-6 | NOT RUN |
| TC-OPS-02 | VPS-NF-002 | NOT RUN |

## Remaining Test Plan activities

| Activity | Status | Reason / scope |
|---|---|---|
| TC-Perf-02 / VPS-NF-005 | NOT RUN | Deployed 100-to-1000-user JMeter experiment and representative horizontal topology unavailable. |
| TC-Perf-01 / VPS-NF-001 | FAIL (local sample) | Local entry/exit p90 exceeded 3000 ms; deployed baseline still unverified. |
| TC-Sec-02 / VPS-SR-001 | PARTIAL | Local TLS/config suite only; external testssl.sh and OWASP ZAP scan not executed. |
| TC-OPS-02 / VPS-NF-002 | NOT RUN | A full month of uptime observations is not available. |
| TC-UAT-01 and TC-UAT-02 | NOT RUN | Real-user acceptance, browser workflows, screen-reader, contrast and print review require execution. |
| TC-INT-01 | NOT RUN | Hardware, external gateway sandbox and actual email/SMS delivery not verified; current hooks use simulators/outbox. |
| TC-Sec-01 / compliance | PARTIAL | Automated no-secret/PAN checks are evidence, not a regulatory compliance assessment. |

## Recorded metrics

| Measure | Observed value |
|---|---|
| Acceptance assertion execution | 50 / 50 |
| Acceptance pass rate | 100.0% of recorded assertions |
| Backend assertion execution | 265 / 265 |
| Catalog case groups passing locally | 25 / 32; partial and not-run groups retained |
| Defect density / aging | Not computed: no consistent historical defect population or lifecycle dates supplied |

## Exit decision

**Not ready for unconditional Test Plan sign-off.** Passing automated functional checks does not satisfy the plan requirement that every test case pass. Complete the pending external, performance, accessibility, UAT and monitoring checks before an authorized reviewer signs. No approval or signature is fabricated.

