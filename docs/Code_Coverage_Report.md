# Code Coverage Report

Evidence generated: 30 October 2026, 23:31 IST. Baseline commit: 9ea6b597a8d51b4070b80182b056575b8c183aeb. Tests include the supplied working-tree changes.

This is an automated local verification record. It is not UAT sign-off or deployment certification. Simulated business dates in November are test inputs; execution dates are not backdated.

## Measurement

Jest uses Istanbul instrumentation during the complete backend run. The denominator includes every backend/src/**/*.js source file, including models, route handlers and startup code. Frontend source is not included. Coverage measures execution, not correctness or requirement acceptance.

The source-file audit reconciles the coverage map against all 64 backend JavaScript files. Any unloaded file missing from the original Jest map receives an Istanbul zero-hit map, never assumed coverage. See evidence/coverage-scope.json for the original totals, added files and corrected totals. The Jest discovery roots were corrected after execution; a discovery-only check confirmed the identical recorded suite set for future runs.

| Metric | Covered | Total | Percent |
|---|---|---|---|
| lines | 1881 | 2031 | 92.61% |
| statements | 2209 | 2459 | 89.83% |
| functions | 466 | 506 | 92.09% |
| branches | 1171 | 1454 | 80.53% |

## Per-file code coverage

| Source | Lines | Statements | Functions |
|---|---|---|---|
| backend/src/accessLog.js | 81.81% | 77.5% | 62.5% |
| backend/src/accounts.js | 79.31% | 75.6% | 87.5% |
| backend/src/app.js | 94.33% | 93.1% | 85.71% |
| backend/src/archive.js | 97.03% | 92.77% | 88.88% |
| backend/src/auth.js | 100% | 100% | 100% |
| backend/src/cache.js | 100% | 90% | 90% |
| backend/src/clock.js | 100% | 100% | 100% |
| backend/src/config.js | 86.36% | 68.75% | 75% |
| backend/src/configuration.js | 84.95% | 78.73% | 90.19% |
| backend/src/entry.js | 95.31% | 93.63% | 96.29% |
| backend/src/errors.js | 100% | 100% | 100% |
| backend/src/events.js | 100% | 100% | 100% |
| backend/src/exit.js | 98.18% | 96.96% | 100% |
| backend/src/facilities.js | 100% | 100% | 100% |
| backend/src/gates.js | 100% | 92.3% | 100% |
| backend/src/hardware.js | 86.88% | 84.84% | 85.71% |
| backend/src/logger.js | 75% | 77.77% | 100% |
| backend/src/loginThrottle.js | 100% | 92% | 100% |
| backend/src/metrics.js | 100% | 93.33% | 100% |
| backend/src/middleware/auth.js | 100% | 100% | 100% |
| backend/src/middleware/cardData.js | 100% | 96.66% | 100% |
| backend/src/models/AccessLog.js | 100% | 100% | 100% |
| backend/src/models/ArchiveFile.js | 100% | 100% | 100% |
| backend/src/models/AuditLog.js | 100% | 100% | 100% |
| backend/src/models/Counter.js | 100% | 100% | 100% |
| backend/src/models/Facility.js | 100% | 100% | 100% |
| backend/src/models/Gate.js | 100% | 100% | 100% |
| backend/src/models/JobLock.js | 100% | 100% | 100% |
| backend/src/models/LoginThrottle.js | 100% | 100% | 100% |
| backend/src/models/Payment.js | 100% | 100% | 100% |
| backend/src/models/Rate.js | 100% | 100% | 100% |
| backend/src/models/Receipt.js | 100% | 100% | 100% |
| backend/src/models/Reservation.js | 100% | 100% | 100% |
| backend/src/models/Session.js | 100% | 100% | 100% |
| backend/src/models/Slot.js | 100% | 100% | 100% |
| backend/src/models/User.js | 100% | 100% | 100% |
| backend/src/models/Vehicle.js | 100% | 100% | 100% |
| backend/src/models/Zone.js | 100% | 100% | 100% |
| backend/src/notifications.js | 100% | 92.3% | 100% |
| backend/src/occupancy.js | 100% | 100% | 100% |
| backend/src/paymentGateway.js | 94.73% | 95.45% | 83.33% |
| backend/src/payments.js | 99.03% | 96.96% | 100% |
| backend/src/permissions.js | 100% | 100% | 100% |
| backend/src/pricing.js | 100% | 100% | 100% |
| backend/src/qr.js | 100% | 100% | 100% |
| backend/src/receipts.js | 100% | 97.43% | 100% |
| backend/src/reports.js | 100% | 96.44% | 100% |
| backend/src/reservations.js | 98.96% | 95.83% | 100% |
| backend/src/routes/admin.js | 93.33% | 92.5% | 84.61% |
| backend/src/routes/auth.js | 100% | 100% | 100% |
| backend/src/routes/events.js | 100% | 94.44% | 75% |
| backend/src/routes/facilities.js | 100% | 100% | 100% |
| backend/src/routes/gate.js | 100% | 100% | 100% |
| backend/src/routes/payments.js | 100% | 100% | 100% |
| backend/src/routes/reports.js | 100% | 100% | 100% |
| backend/src/routes/reservations.js | 100% | 100% | 100% |
| backend/src/routes/slots.js | 100% | 100% | 100% |
| backend/src/routes/test.js | 0% | 0% | 0% |
| backend/src/routes/users.js | 97.36% | 97.5% | 100% |
| backend/src/server.js | 0% | 0% | 0% |
| backend/src/slotSearch.js | 100% | 98.33% | 100% |
| backend/src/time.js | 100% | 100% | 100% |
| backend/src/transport.js | 90.38% | 90% | 100% |
| backend/src/validation.js | 98.36% | 96.1% | 100% |

## Interpretation and evidence

No numeric coverage target is specified in the Part-3 assignment; none is invented here. Startup code is included even though the instrumented Jest run does not launch server.js as the production entry point. The acceptance server is a separate, uninstrumented process; its executions are not silently added to this denominator.

Open coverage/index.html for navigable source detail. coverage/coverage-final.json stores per-location execution counts; coverage/coverage-summary.json stores these aggregates.

