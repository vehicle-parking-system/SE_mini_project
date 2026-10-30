# Test Summary and Part-3 Checklist

Evidence generated: 30 October 2026, 23:31 IST. Baseline commit: 9ea6b597a8d51b4070b80182b056575b8c183aeb. Tests include the supplied working-tree changes.

This is an automated local verification record. It is not UAT sign-off or deployment certification. Simulated business dates in November are test inputs; execution dates are not backdated.

| Deliverable | Result | Location |
|---|---|---|
| Updated test cases | Prepared with requirement IDs, steps, expected and actual results | Test_Cases_Updated.md |
| Unit Test Report | 51 passed / 0 failed / 0 skipped / 51 total | Unit_Test_Report.md |
| System Validation Report | 50 passed / 0 failed / 0 skipped / 50 total; outstanding checks explicit | System_Validation_Report.md |
| Code Coverage Report | 92.61% lines | Code_Coverage_Report.md |
| Branch Coverage Report | 80.53% branches | Branch_Coverage_Report.md |
| Reports in repository docs/ | Prepared locally; remote upload not performed | This folder |
| All Test Plan testing | PARTIAL - external/manual checks remain | System_Validation_Report.md |
| Optional Sprint 3 | Conditional backlog recorded; no completion/sign-off claimed | Sprint_3_Backlog.md |

## Validation limits

| Activity | Status | Reason |
|---|---|---|
| TC-Perf-02 / VPS-NF-005 | NOT RUN | Deployed 100-to-1000-user JMeter experiment and representative horizontal topology unavailable. |
| TC-Perf-01 / VPS-NF-001 | FAIL (local sample) | Local entry/exit p90 exceeded 3000 ms; deployed baseline still unverified. |
| TC-Sec-02 / VPS-SR-001 | PARTIAL | Local TLS/config suite only; external testssl.sh and OWASP ZAP scan not executed. |
| TC-OPS-02 / VPS-NF-002 | NOT RUN | A full month of uptime observations is not available. |
| TC-UAT-01 and TC-UAT-02 | NOT RUN | Real-user acceptance, browser workflows, screen-reader, contrast and print review require execution. |
| TC-INT-01 | NOT RUN | Hardware, external gateway sandbox and actual email/SMS delivery not verified; current hooks use simulators/outbox. |
| TC-Sec-01 / compliance | PARTIAL | Automated no-secret/PAN checks are evidence, not a regulatory compliance assessment. |

## Authenticity

Actual local evidence is dated 30 October 2026, 23:31 IST. The assignment asks for testing on November 2-6; these are early execution results and should be rerun in that window. The Test Plan dates UAT November 2-6. No report claims those future activities happened. Source provenance and file hashes are in evidence/provenance.json. GitHub connection reported pull=true and push=false during preparation, so the package is ready for upload but not uploaded.


## Recorded command outcomes

| Command group | Exit code |
|---|---|
| unit | 0 |
| backend-tests | 0 |
| gate-benchmark | 0 |
| acceptance | 0 |
| frontend-build | 0 |
| coverage-scope | 0 |

