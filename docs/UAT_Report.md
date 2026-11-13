# UI Walkthrough and Usability Report (TC-UAT-01 / TC-UAT-02)

| | |
|---|---|
| Jira | VPS-44 (review of `feature/ui-refresh`), VPS-38 (usability and accessibility) |
| Tester | Daruru Bhuvan Sai (QA Lead) |
| Date | 13 November 2026 |
| Build | `feature/ui-refresh` @ `0c68345` (web app restyle and sidebar layout) on top of `main` @ `e1b1c88` |
| Environment | macOS arm64, Chromium-based browser pane, viewports 538×552 (phone layout) and 1280×800 (desktop); Node 24, Vite dev server, API on `http://localhost:4000`, disposable MongoDB 7; `seed-demo.js` facilities; sandbox payment gateway with auto-confirm |
| Accounts | Self-registered driver; first admin from `ADMIN_EMAIL`; attendant created through the Staff page. All test-only. |

This is a scripted QA walkthrough by the QA lead, not real-user acceptance. It verifies that the workflows work in a browser and checks labels, focus and contrast. Feedback from real drivers and attendants and a screen-reader session are still open (see "Not covered").

## Result

| Area | Steps | Result | Evidence |
|---|---|---|---|
| Driver registration | Submit the form with a vehicle | PASS: account created, lands on Profile with the vehicle listed | `evidence/uat/02-driver-registered-profile.jpg` |
| Slot search (VPS-F-020/021) | City Centre Parking, Car, Sat 14 Nov 10:00–12:00 | PASS: 14 free slots, nearest first with distance, live "updated" stamp | — |
| Booking (VPS-F-020/022) | Book the nearest slot A-01 | PASS: "Slot A-01 is booked", status Booked, QR code, ₹100 for 2 h, "Arrive by 10:15 or the slot is released" | `03-booking-confirmed-mobile.jpg`, `04-booking-desktop.jpg` |
| Gate entry (VPS-F-001/002/004) | Admit walk-in `MH12QA0001` (ANPR) | PASS: barrier opened, nearest slot P1-01, entry ticket with QR and running fee, occupancy 13 → 12 free | `06-gate-console.jpg` |
| Exit fee (VPS-F-010/011) | Paste the ticket code, Calculate fee | PASS: ₹30 due (one started hour at ₹30/h); barrier stays closed until paid | `07-exit-fee-due-barrier-closed.jpg` |
| At-gate payment and exit (VPS-F-011/012/013, VPS-F-031) | As attendant: plate lookup, Take card payment | PASS: sandbox payment confirmed, barrier opened, receipt VPS-2026-000001 with gateway ref, occupancy back to 13/13 immediately | `09-exit-paid-receipt-slot-released.jpg` |
| Staff management (VPS-F-041) | Admin creates an attendant | PASS: confirmation shown, attendant listed | — |
| Role boundaries in the UI (VPS-SR-003) | Attendant menu shows only Gate and Monitor; admin pages show "Not permitted" | PASS | `05-…jpg` |
| Admin at the gate | Admin runs an exit and takes payment | **FAIL**: DEF-001 | `08-DEF-001-admin-gate-payment-denied.jpg` |
| Login after another user logs out | Driver logs out, admin logs in; admin logs out, attendant logs in | **FAIL**: DEF-002 | `05-DEF-002-login-redirect-not-permitted.jpg` |
| Production build of the branch | `vite build` | PASS: built in 356 ms, no warnings | — |

## Accessibility checks

| Check | Method | Result |
|---|---|---|
| Form labels | DOM check of every input's `labels` / `aria-label` on Register, Login, Search, Gate, Staff | PASS: all inputs labelled (the tree tool showing placeholders was a tool artefact, verified in the DOM) |
| Colour contrast (WCAG 2.1 AA) | Computed foreground/background ratio for every distinct text style on the Gate page (26 styles), using 4.5:1 or 3:1 for large text | PASS: 0 failures |
| Keyboard focus | `styles.css`: global `:focus-visible` 3 px outline, inputs 2 px primary outline | PASS: focus never suppressed |
| Segmented controls | ANPR/QR/Manual and Ticket/Plate use `role="radiogroup"` + `role="radio"` + `aria-checked` | PASS |
| Live results | Gate results use `role="status"`, errors `role="alert"` | PASS |
| Language and headings | `<html lang="en">`, one `h1` per page | PASS |
| Repeated control names | Search results list | **FAIL**: DEF-003 |
| Responsive layout | 538 px: sidebar collapses into a Menu button; 1280 px: sidebar | PASS |

## Defects raised

| ID | Severity / priority | Summary | Also on `main`? |
|---|---|---|---|
| DEF-001 (VPS-47, issue #23) | Major / High | Gate page offers **Take card payment** to admins, but `POST /api/payments` only allows Driver and Attendant (`backend/src/permissions.js:53`), so the admin gets "You do not have permission to do this" and a walk-in vehicle admitted by an admin cannot leave without an attendant. Either allow ADMIN for at-gate payments or hide the button for admins. | Yes, the branch only changes styles |
| DEF-002 (VPS-48, issue #24) | Minor / Medium | After logout, `RequireAuth` redirects to `/login` with `state.from` = the previous user's page, and `Login.jsx:22` navigates there for whoever logs in next. A different role lands on "Not permitted". Clear `from` on logout or ignore it when the new role can't open it. | Yes |
| DEF-003 (VPS-49, issue #25) | Minor / Low | Every result in slot search has a button named just "Book". Screen-reader users browsing by button can't tell which slot each one books (WCAG 2.4.6 / 2.5.3). Add `aria-label={\`Book slot ${number}\`}`. | Yes |

None of the three was introduced by `feature/ui-refresh`; they reproduce on `main`. **Verdict for the branch: no regressions found, recommend that its author raise the pull request.** The three defects are logged in the Defect Register and on Jira for the developer to fix and QA to retest.

## Not covered

- Real-user sessions with drivers/attendants and a screen-reader run (VoiceOver/NVDA)
- Firefox and Safari; this run used one Chromium engine
- Printing tickets and receipts on paper
- Real payment gateway, SMS/email delivery and gate hardware (still simulators, see TC-INT-01)
