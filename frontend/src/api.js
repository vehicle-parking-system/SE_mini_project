// Thin client for the VPS REST API. Errors are thrown as ApiError with the
// server's message and per-field details ({error: {code, message, details}}).
const BASE = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

let authToken = null;
export const setToken = (token) => { authToken = token; };

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(authToken && { authorization: `Bearer ${authToken}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error?.message || "Something went wrong", data.error?.details);
  return data;
}

export const api = {
  register: (body) => request("POST", "/api/auth/register", body),
  login: (email, password) => request("POST", "/api/auth/login", { email, password }),
  me: () => request("GET", "/api/users/me"),
  updateMe: (body) => request("PATCH", "/api/users/me", body),
  changePassword: (currentPassword, newPassword) => request("POST", "/api/users/me/password", { currentPassword, newPassword }),
  addVehicle: (vehicle) => request("POST", "/api/users/me/vehicles", vehicle),
  removeVehicle: (id) => request("DELETE", `/api/users/me/vehicles/${id}`),
  listAttendants: () => request("GET", "/api/admin/attendants"),
  createAttendant: (details) => request("POST", "/api/admin/attendants", details),
};

export const ROLE_LABELS = { DRIVER: "Driver", ATTENDANT: "Attendant", ADMIN: "Admin" };

export const VEHICLE_TYPES = [
  { value: "CAR", label: "Car" },
  { value: "BIKE", label: "Bike" },
  { value: "TRUCK", label: "Truck" },
];
