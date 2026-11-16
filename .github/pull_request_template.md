<!-- Title: "VPS-<n>: <what changes, in the imperative>" — the Jira key links the PR to the board. -->

Jira: [VPS-](https://yvbhavanareddy.atlassian.net/browse/VPS-)

## What and why
<!-- What this changes and the requirement it serves (VPS-F-…, VPS-NF-…, VPS-SR-…). -->

## How it was tested
<!-- Commands you ran and what they showed. Paste counts, not "tests pass". -->
| Check | Result |
|---|---|
| `npm test` in `backend/` (with `MONGO_URL` → disposable DB) | |
| Acceptance suite / `scripts/verify-part3.cjs` (if API behaviour changed) | |
| Manual check in the web app (if UI changed) | |

## QA checklist
- [ ] Requirement and test case IDs (TC-…) named above
- [ ] New or changed behaviour has a test that fails without the change
- [ ] Error responses follow the API contract (status code + `error.code`)
- [ ] New endpoint added to `backend/src/permissions.js` (default deny) and `tests/contract.js`
- [ ] No passwords, tokens or card data in logs or responses (VPS-NF-003)
- [ ] README / docs updated; deviation from SRS/SAD recorded in `docs/Design_Deviations.md`
- [ ] CI green
- [ ] Reviewed by the repository owner before merge
