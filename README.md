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
| `POST /api/auth/login` | `{email, password}` → `{token, user}`. Returns 401 for a wrong email or password |
| `GET /api/users/me` | `{user, vehicles}` |
| `PATCH /api/users/me` | `{name?, phone?}` |
| `POST /api/users/me/password` | `{currentPassword, newPassword}` → 204 |
| `POST /api/users/me/vehicles` | `{plateNumber, vehicleType: CAR\|BIKE\|TRUCK}` → 201 |
| `DELETE /api/users/me/vehicles/:id` | 204 |
| `GET /api/admin/audit-logs?event=` | Admin only. For example `?event=ACCESS_DENIED` |
| `POST /api/admin/attendants` | Admin only. `{name, email, password, phone?}` → `201 {user}` with role ATTENDANT |
| `GET /api/admin/attendants` | Admin only. Lists attendant accounts |

**Role-Based Access Control (VPS-SR-003).** [`backend/src/permissions.js`](backend/src/permissions.js) is the single policy table that lists which roles may call each endpoint, including modules that haven't been built yet. The `authorize` middleware checks every `/api` request against it before any route runs:

- An endpoint with no rule is denied (404), so a new endpoint must be added to the policy before it can be reached.
- A missing or invalid token gets 401. The role is read from the database, so an edited token, or a token issued before a role change, is rejected.
- A role that isn't permitted gets 403, and the denial is recorded as an `ACCESS_DENIED` audit entry.

| Role | Can use |
|---|---|
| Driver | Own profile and vehicles, slot search, reservations, online payment, receipts |
| Attendant | Own profile, gate entry and exit, ticket scan, sessions, slot status, occupancy, at-gate payment, receipts |
| Admin | Everything under `/api/admin/*`, reports, reservation lookup and cancellation, gate operations |

Attendants are created by an admin (the Staff page in the web app). The first admin is created at startup from `ADMIN_EMAIL` and `ADMIN_PASSWORD` (optional `ADMIN_NAME`). An existing non-admin account with that email is never promoted.

Self-registration always creates a Driver. Passwords are stored as bcrypt hashes (VPS-SR-002). Login returns an HS256 JWT, and the user's role is re-checked against the database on every request. A wrong password and an unknown email get the same response, with the same timing. Request bodies and tokens are never logged (VPS-NF-003).

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
