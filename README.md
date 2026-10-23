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

Self-registration always creates a Driver. Passwords are stored as bcrypt hashes (VPS-SR-002). Login returns an HS256 JWT, and the user's role is re-checked against the database on every request. A wrong password and an unknown email get the same response, with the same timing. Request bodies and tokens are never logged (VPS-NF-003).

## Running locally

Requires Node 20+ and MongoDB.

```bash
# API on http://localhost:4000
cd backend && npm install
MONGO_URL=mongodb://localhost:27017/vps JWT_SECRET=change-me npm start
npm test                       # set MONGO_URL to also run the DB-backed API tests

# Driver Web App on http://localhost:5173 (proxies /api to :4000)
cd frontend && npm install && npm run dev
```
