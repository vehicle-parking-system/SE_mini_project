// Thin client for the VPS REST API. Errors are thrown as ApiError with the
// server's message and per-field details ({error: {code, message, details}}).
const BASE = import.meta.env.VITE_API_URL || "";

// `data` is the whole error body, e.g. the amount due that comes with a 402
export class ApiError extends Error {
  constructor(status, message, details, data) {
    super(message);
    this.status = status;
    this.details = details || {};
    this.data = data || {};
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
  if (!res.ok) throw new ApiError(res.status, data.error?.message || "Something went wrong", data.error?.details, data);
  return data;
}

// Live slot events (GET /api/events, server-sent events). Read with fetch so the token goes in
// the Authorization header, not the URL. Calls onEvent(event) for each event and reconnects
// with backoff if the connection drops. Returns a function that closes the stream.
export function liveEvents(params, onEvent) {
  let controller = null;
  let closed = false;
  let retryMs = 1000;
  async function connect() {
    controller = new AbortController();
    try {
      const res = await fetch(`${BASE}/api/events?${new URLSearchParams(params)}`, {
        headers: { authorization: `Bearer ${authToken}` }, signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
      retryMs = 1000;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop();
        for (const block of blocks) {
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          if (data) onEvent(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* dropped, refused or closed */ }
    if (!closed) {
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    }
  }
  connect();
  return () => { closed = true; controller?.abort(); };
}

export const api = {
  register: (body) => request("POST", "/api/auth/register", body),
  login: (email, password) => request("POST", "/api/auth/login", { email, password }),
  me: () => request("GET", "/api/users/me"),
  updateMe: (body) => request("PATCH", "/api/users/me", body),
  changePassword: (currentPassword, newPassword) => request("POST", "/api/users/me/password", { currentPassword, newPassword }),
  addVehicle: (vehicle) => request("POST", "/api/users/me/vehicles", vehicle),
  removeVehicle: (id) => request("DELETE", `/api/users/me/vehicles/${id}`),
  facilities: () => request("GET", "/api/facilities"),
  searchSlots: (params) => request("GET", `/api/slots/available?${new URLSearchParams(params)}`),
  reserve: (booking) => request("POST", "/api/reservations", booking),
  myReservations: () => request("GET", "/api/reservations"),
  myReceipts: () => request("GET", "/api/users/me/receipts"),
  receipt: (id) => request("GET", `/api/receipts/${id}`),
  mySessions: () => request("GET", "/api/users/me/sessions"),
  cancelReservation: (id) => request("POST", `/api/reservations/${id}/cancel`),
  enter: (entry) => request("POST", "/api/entry", entry),
  occupancy: (facilityId) => request("GET", `/api/occupancy/${facilityId}`),
  exit: (body) => request("POST", "/api/exit", body),
  pay: (body) => request("POST", "/api/payments", body),
  scanTicket: (qrCode) => request("POST", "/api/tickets/scan", { qrCode }),
  sessions: (params) => request("GET", `/api/sessions?${new URLSearchParams(params)}`),
  transactions: (params = {}) => request("GET", `/api/admin/transactions?${new URLSearchParams(params)}`),
  listAttendants: () => request("GET", "/api/admin/attendants"),
  createAttendant: (details) => request("POST", "/api/admin/attendants", details),
  lockedAccounts: () => request("GET", "/api/admin/locked-accounts"),
  unlockUser: (id) => request("POST", `/api/admin/users/${id}/unlock`),
  auditLogs: (events) => request("GET", `/api/admin/audit-logs?event=${encodeURIComponent(events.join(","))}`),
  adminFacilities: () => request("GET", "/api/admin/facilities"),
  createFacility: (facility) => request("POST", "/api/admin/facilities", facility),
  updateFacility: (id, fields) => request("PATCH", `/api/admin/facilities/${id}`, fields),
  addZone: (facilityId, zone) => request("POST", `/api/admin/facilities/${facilityId}/zones`, zone),
  addGate: (facilityId, gate) => request("POST", `/api/admin/facilities/${facilityId}/gates`, gate),
  addSlots: (zoneId, slots) => request("POST", `/api/admin/zones/${zoneId}/slots`, { slots }),
  updateSlot: (id, fields) => request("PATCH", `/api/admin/slots/${id}`, fields),
  setRate: (rate) => request("PUT", "/api/admin/rates", rate),
  deleteRate: (id) => request("DELETE", `/api/admin/rates/${id}`),
};

// No real payment gateway is connected yet: the sandbox accepts this token in place of the one
// its checkout (or the card terminal at the gate) would produce, and confirms the payment itself.
export const SANDBOX_GATEWAY_TOKEN = "tok_sandbox_visa";

export const formatMoney = (amount) => `₹${Number(amount).toLocaleString("en-IN")}`;

// 61 -> "1 h 1 min"
export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h && `${h} h`, (m || !h) && `${m} min`].filter(Boolean).join(" ");
}

export const ROLE_LABELS = { DRIVER: "Driver", ATTENDANT: "Attendant", ADMIN: "Admin" };

export const RESERVATION_STATUS = {
  HELD: { label: "Booked", hint: "Pay online or at the gate" },
  CONFIRMED: { label: "Confirmed", hint: "Paid" },
  EXPIRED: { label: "Expired", hint: "You didn't arrive within the grace period" },
  CHECKED_IN: { label: "Parked", hint: "You're parked in this slot" },
  COMPLETED: { label: "Completed", hint: "" },
  CANCELLED: { label: "Cancelled", hint: "" },
  REFUNDED: { label: "Refunded", hint: "Cancelled and refunded" },
};

export const VEHICLE_TYPES = [
  { value: "CAR", label: "Car" },
  { value: "BIKE", label: "Bike" },
  { value: "TRUCK", label: "Truck" },
];
