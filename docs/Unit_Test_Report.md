# Unit Test Report

Evidence generated: 30 October 2026, 23:31 IST. Baseline commit: 9ea6b597a8d51b4070b80182b056575b8c183aeb. Tests include the supplied working-tree changes.

This is an automated local verification record. It is not UAT sign-off or deployment certification. Simulated business dates in November are test inputs; execution dates are not backdated.

## Scope and method

Isolated Jest checks cover input normalization/validation, RBAC policy lookup, and pure fee boundaries. These three suites do not need MongoDB or an HTTP server. Database/API tests are separately reported as integration checks.

Result: **51 passed / 0 failed / 0 skipped / 51 total**.

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| backend/test/pricing.test.js | 9 | 0 | 0 |
| backend/test/validation.test.js | 10 | 0 | 0 |
| backend/test/permissions.test.js | 32 | 0 | 0 |

## Boundary evidence

Pricing covers 0, 1, 30, 60, 61, 120 and 165 minutes; the minimum charge is one started hour. Duration rounding is checked at the half-minute boundary and for a negative elapsed value. Registration tests include invalid fields, duplicate normalized plates, weak passwords and optional vehicles.

## Execution details

See evidence/unit-results.json for individual assertions and evidence/unit.log for console output. Reproduce using the isolated command in README.md. The full backend run repeats these assertions; do not add unit and full-backend totals as independent tests.

