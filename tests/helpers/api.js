const crypto = require("crypto");
const C = require("../contract");
const { fixture, PASSWORD } = require("./fixture");

const API_URL = process.env.API_URL;
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "test_webhook_secret";

// Without API_URL there is no backend to test: every suite is skipped (CI sets it
// only when backend/ exists). With API_URL set, an unreachable API fails the run.
const describeApi = API_URL ? describe : describe.skip;

async function request(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  if (!raw) { try { data = JSON.parse(text); } catch { /* non-JSON body */ } }
  return { status: res.status, headers: res.headers, body: data };
}
const api = {
  get: (p, o) => request("GET", p, o),
  post: (p, body, o = {}) => request("POST", p, { ...o, body }),
  put: (p, body, o = {}) => request("PUT", p, { ...o, body }),
  patch: (p, body, o = {}) => request("PATCH", p, { ...o, body }),
};

const OK = [200, 201];

// Wipes the DB, seeds the fixture, sets the clock and logs everyone in.
// Returns {ids, tokens} for use in the test.
async function resetAndLogin({ now = "2026-11-02T10:00:00+05:30" } = {}) {
  const seeded = await api.post(C.test.reset, fixture);
  if (!OK.includes(seeded.status)) throw new Error(`test reset failed: ${seeded.status} ${JSON.stringify(seeded.body)}`);
  await setClock(now);
  const tokens = {};
  for (const u of fixture.users) tokens[u.key] = await login(u.email);
  return { ids: seeded.body.ids, tokens };
}

async function login(email, password = PASSWORD) {
  const res = await api.post(C.login, { email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status}`);
  return res.body.token;
}

const setClock = (now) => api.post(C.test.clock, { now });

async function hardwareCommands(gateId) {
  const res = await api.get(C.test.hardwareCommands);
  return res.body.commands.filter((c) => !gateId || c.gateId === gateId);
}

function signedWebhook(payload) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  return api.post(C.paymentWebhook, body, {
    headers: { "content-type": "application/json", [C.webhookSignatureHeader]: signature },
  });
}

// Pays for a session or reservation and confirms it through the gateway webhook.
async function payAndConfirm(token, target, method = "AT_GATE") {
  const pay = await api.post(C.payments, { ...target, method, gatewayToken: "tok_sandbox_visa" }, { token });
  expect(OK).toContain(pay.status);
  const hook = await signedWebhook({ paymentId: pay.body.paymentId, status: "CONFIRMED" });
  expect(OK).toContain(hook.status);
  return pay.body.paymentId;
}

const enterVehicle = (token, { gateId, plateNumber, vehicleType = "CAR", source = "ANPR", qrCode }) =>
  api.post(C.entry, { gateId, vehicleType, source, ...(qrCode ? { qrCode } : { plateNumber }) }, { token });

module.exports = { API_URL, describeApi, api, OK, resetAndLogin, login, setClock, hardwareCommands,
  signedWebhook, payAndConfirm, enterVehicle };
