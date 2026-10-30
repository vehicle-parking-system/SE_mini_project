# Vehicle Parking System acceptance tests

These Jest suites exercise a running API against the project Software Test Plan, SRS and SAD in [vehicle-parking-system/Docs](https://github.com/vehicle-parking-system/Docs). Test names retain the TC-* IDs and VPS-* requirement IDs.

| Folder | Scope |
|---|---|
| api/ | Entry, exit, search, reservation, payment, admin, reports and hardware simulator resilience |
| security/ | RBAC, salted hashes, lockout, throttling, stored card data and log review |
| performance/ | JMeter plan and result checker for an explicitly configured staging environment |

Updated case procedures, actual results, full requirements traceability and remaining external/manual checks are in [docs/README.md](../docs/README.md). The generated [RTM](RTM.md) is a dated snapshot, not a substitute for raw test evidence.

## Repeatable execution

Follow the root-level Part-3 verifier instructions in docs/README.md for a full local run. A dedicated disposable MongoDB is required because fixture/reset hooks erase test data. `NODE_ENV=test` enables hooks; they must not be exposed in production.

To run only this acceptance package, configure `API_URL` for the test server, `MONGO_URL` for its fixture database, `PAYMENT_WEBHOOK_SECRET` to match the server, and `BACKEND_LOG` for captured server output, then run `npm test -- --runInBand`. Without these variables some suites intentionally skip; a skipped suite is not a pass.

All HTTP paths are centralized in contract.js. helpers/fixture.js defines dummy identities, slots, prices and expected fee rules. Fee rounding uses at least one started hour; this is the implemented rule, while the source SRS leaves rounding details unspecified. TC-Res-02 uses a fixture-only booking hook to isolate search behavior. TC-Admin-03 tests an actual barrier override and verifies the nested returned user ID and detailed audit record.

## Scope limits

The automated API tests use simulated hardware, signed synthetic gateway webhooks and a notification outbox. Actual SMS/email delivery, real gateway/vendor devices, browser usability/accessibility and user acceptance require separate execution. Nightly JMeter/testssl.sh/ZAP checks still need a configured staging URL and credentials. Monthly availability cannot be inferred from short local test runs.

CI now uses scripts/verify-part3.cjs and scripts/generate-part3-reports.py, and uploads docs/ with machine-readable evidence and printable reports. The legacy rtm-report.js can summarize acceptance JSON alone; use the generated docs matrix for the complete Test Plan scope and backend archival evidence.
