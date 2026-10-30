# Part-3 testing deliverables

Start with `index.html` for the report browser, or `Test_Summary.md`. Printable copies of all seven reports are in `pdf/`. Raw Jest JSON, console logs, the run manifest and SHA-256 provenance are in `evidence/`. Source-linked line/statement/function/branch coverage is in `coverage/index.html`.

## Reproduce

Use Node.js 20 or later, Python 3.13, OpenSSL on PATH, and a **dedicated disposable MongoDB instance**. The suites reset `vps_backend_*` databases as well as the chosen `vps_part3*` database, so do not point these tests at an instance containing valuable data. Use a fresh MongoDB container or temporary MongoDB process. MongoDB must be available before starting the verifier.

Install locked dependencies:

```powershell
npm ci --prefix backend
npm ci --prefix tests
npm ci --prefix frontend
python -m pip install -r scripts/report-requirements.txt
```

From the repository root on Windows:

```powershell
$env:MONGO_URL='mongodb://127.0.0.1:27017/vps_part3'
# If Git for Windows supplies your OpenSSL:
$env:Path='C:\Program Files\Git\usr\bin;' + $env:Path
node scripts/verify-part3.cjs --disposable-db
python scripts/generate-part3-reports.py
```

On Linux/macOS:

```sh
MONGO_URL=mongodb://127.0.0.1:27017/vps_part3 node scripts/verify-part3.cjs --disposable-db
python scripts/generate-part3-reports.py
```

The verifier runs isolated unit tests, full backend coverage, a short local gate benchmark, an HTTP API/security acceptance suite against a temporary API server, and the frontend production build. It records exit codes and runtime metadata. It stops its API server when finished; you manage the disposable MongoDB lifecycle. `PART3_PORT` overrides the default API port 4028. Existing test servers on another port do not need to be reused.

For isolated unit checks alone:

```powershell
node backend/node_modules/jest/bin/jest.js --config backend/package.json --runInBand --runTestsByPath backend/test/validation.test.js backend/test/permissions.test.js backend/test/pricing.test.js
```

Jest may skip TLS certificate tests when OpenSSL is missing. Such skips must remain visible and cannot be counted as passing TLS checks. Running without MongoDB intentionally skips database tests and is not a complete verification run. The unit-only total is a subset of the full-backend total and must not be added to it as independent coverage.

## Deliverable map

| Requirement in assignment | Deliverable |
|---|---|
| Update sprint test cases/document | Test_Cases_Updated.md and PDF |
| Unit Test Report | Unit_Test_Report.md and PDF |
| System Validation Report | System_Validation_Report.md and PDF |
| Code Coverage Report | Code_Coverage_Report.md, PDF and navigable coverage/ |
| Branch Coverage Report | Branch_Coverage_Report.md, PDF and Istanbul branch locations |
| Test Plan traceability | Requirements_Traceability_Matrix.md and ../tests/RTM.md |
| Optional Sprint-3 spillover | Sprint_3_Backlog.md and PDF |
| Evidence and outcome | Test_Summary.md, evidence/ and provenance.json |

CI runs the same verifier against an ephemeral MongoDB service and uploads `docs/` as an Actions artifact. It does not commit report snapshots to GitHub automatically. These prepared files still need a normal commit/push from an account with write access.

## Limits

These are real local automated observations. Browser accessibility/usability, real user acceptance, external TLS/ZAP, deployed 100/1000-user scaling, vendor integrations and monthly availability remain explicitly unverified. The supplied course assignment specifies November 2-6 testing; October 30 results are early evidence, not future UAT results. Refer to the System Validation Report before sign-off.

The short gate benchmark records latency but its process exit code is not a latency-budget assertion. Review the observed p90 values in the System Validation Report. Any local budget miss remains a failed sample even when all functional Jest tests pass.

An interrupted run may be resumed after unit/backend tests with `--resume-after-backend` only when source/test files have not changed and the recorded unit/backend commands succeeded. The manifest retains the prior setup error. A fresh full run remains the normal command.

Coverage is audited by scripts/complete-coverage.cjs. It adds zero-hit Istanbul maps for any unloaded backend source files missing from Jest's map and regenerates HTML/JSON totals. The source audit covers all 64 backend JavaScript files in this snapshot, including startup and test hooks. The audit record retains the original and corrected denominator and confirms the selected suites match the recorded run.
