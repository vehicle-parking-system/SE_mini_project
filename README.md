# Vehicle Parking System

MERN implementation of the [SRS/SAD](https://github.com/vehicle-parking-system/Docs).

| Folder | What |
|---|---|
| `backend/` | Node.js / Express REST API with MongoDB |
| `frontend/` | React (Vite) Driver Web App |
| `tests/` | Acceptance tests from the Software Test Plan (see [tests/README.md](tests/README.md)) |

## Implemented so far

**Driver Registration & Login.** A driver can register with their vehicles, log in, view and edit their profile, change their password, and add or remove vehicles.

| Endpoint | |
|---|---|
| `POST /api/auth/register` | `{name, email, phone, password, vehicles:[{plateNumber, vehicleType}]}` → `201 {token, user, vehicles}`. Returns 400 with per-field `details` or 409 if the email or plate is taken |
| `POST /api/auth/login` | `{email, password}` → `{token, user}`. Returns 401 for a wrong email or password, or 423 while the account is locked |
| `GET /api/users/me` | `{user, vehicles}` |
| `PATCH /api/users/me` | `{name?, phone?}` |
| `POST /api/users/me/password` | `{currentPassword, newPassword}` → 204 |
| `POST /api/users/me/vehicles` | `{plateNumber, vehicleType: CAR\|BIKE\|TRUCK}` → 201 |
| `DELETE /api/users/me/vehicles/:id` | 204 |
| `GET /api/admin/audit-logs?event=` | Admin only |
| `POST /api/admin/attendants` | Admin only. `{name, email, password, phone?}` → `201 {user}` with role ATTENDANT |
| `GET /api/admin/attendants` | Admin only. Lists attendant accounts |
| `GET /api/admin/locked-accounts` | Admin only. Accounts that are locked now, with their failure count and last failed or successful login |
| `POST /api/admin/users/:id/unlock` | Admin only. Ends a lock early → 204, or 404 if the account isn't locked |

**Role-Based Access Control (VPS-SR-003).** [`backend/src/permissions.js`](backend/src/permissions.js) is the single policy table that lists which roles may call each endpoint, including modules that haven't been built yet. The `authorize` middleware checks every `/api` request against it before any route runs:

- An endpoint with no rule is denied (404), so a new endpoint must be added to the policy before it can be reached.
- A missing or invalid token gets 401. The role is read from the database, so an edited token, or a token issued before a role change, is rejected.
- A role that isn't permitted gets 403, and the denial is recorded as an `ACCESS_DENIED` audit entry.

| Role | Can use |
|---|---|
| Driver | Own profile and vehicles, slot search, reservations, online payment, receipts |
| Attendant | Own profile, gate entry and exit, ticket scan, sessions, slot status, occupancy, at-gate payment, receipts |
| Admin | Everything under `/api/admin/*`, reports, reservation lookup and cancellation, gate operations |

**Login Security & Account Lockout (VPS-SR-005).** In `backend/src/auth.js`:

- **Every attempt is tracked.** Each failure writes a `LOGIN_FAILED` audit entry with the reason (`WRONG_PASSWORD` with the attempt number, or `UNKNOWN_EMAIL`) and the client IP. It also updates `failedLoginAttempts` and `lastFailedLoginAt` on the account.
- **5 consecutive failures** (`MAX_FAILED_LOGINS`) lock the account for 15 minutes (`LOCK_MINUTES`). The lock writes an `ACCOUNT_LOCKED` audit entry, raises an `ALERT` warning in the log and sends an email notification to the account owner.
- **A successful login resets the count**, so only consecutive failures count. When a lock expires, the count starts over.
- **While locked, the password isn't checked at all.** Login returns 423 with `lockedUntil`, and the attempt is recorded as `LOGIN_BLOCKED`.
- **Parallel guessing doesn't help.** Each attempt reserves one of the 5 allowed attempts in a single atomic database update before the password is checked. However many requests arrive at once, at most 5 passwords are checked, and the account locks exactly once.
- **Unknown emails** take the same time and get the same 401 as a wrong password, so the response doesn't reveal which emails are registered. They never lock anything.
- **Admins** can see locked accounts and recent login events on the **Security** page of the web app, and unlock an account early. Each unlock is audited as `ACCOUNT_UNLOCKED`.
- Set `TRUST_PROXY` (for example `1`) when running behind a load balancer, so the recorded IP is the client's.

There is no SMS or email gateway yet. Notifications are recorded in an outbox (readable through `GET /api/test/notifications` in test mode) and logged without the recipient's address.

Self-registration always creates a Driver. Attendants are created by an admin (the Staff page in the web app). The first admin is created at startup from `ADMIN_EMAIL` and `ADMIN_PASSWORD` (optional `ADMIN_NAME`). An existing non-admin account with that email is never promoted.

Security: passwords are stored as bcrypt hashes (VPS-SR-002). JWTs are HS256, and the role is re-checked against the database on every request (VPS-SR-003). Request bodies and tokens are never logged (VPS-NF-003).

## Running locally

Requires Node 20+ and MongoDB.

```bash
# API on http://localhost:4000
cd backend && npm install
MONGO_URL=mongodb://localhost:27017/vps JWT_SECRET=change-me \
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=change-me-123 npm start
npm test                       # set MONGO_URL to also run the DB-backed API tests

# Driver Web App on http://localhost:5173 (proxies /api to :4000)
cd frontend && npm install && npm run dev
```
