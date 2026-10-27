// Gate transaction benchmark (VPS-NF-001: 90% of entry/exit transactions within 3 s).
// Runs the API in-process on a scratch database, seeds a facility with a history of past stays,
// bookings and payments, then drives `lanes` concurrent gate lanes. Each lane loops:
// entry -> at-gate payment -> signed gateway webhook -> exit. Prints p50/p90/p99 per step.
//
//   MONGO_URL=mongodb://localhost:27017/vps_bench node scripts/bench-gate.js [lanes] [cycles] [history]
// The database named in MONGO_URL is dropped first. Defaults: 50 lanes, 10 cycles, 20000 past stays.
process.env.NODE_ENV ||= "test";
process.env.PAYMENT_SANDBOX_AUTOCONFIRM = "false";
const crypto = require("crypto");
const mongoose = require("mongoose");
const config = require("../src/config");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const Payment = require("../src/models/Payment");
const Reservation = require("../src/models/Reservation");
const Session = require("../src/models/Session");
const Vehicle = require("../src/models/Vehicle");

const [lanes = 50, cycles = 10, history = 20000] = process.argv.slice(2).map(Number);
if (![lanes, cycles, history].every((n) => Number.isInteger(n) && n >= 0) || !lanes || !cycles) {
  console.error("usage: node scripts/bench-gate.js [lanes] [cycles] [history]   (positive whole numbers)");
  process.exit(2);
}
const SLOTS = 600;

const p = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];

async function seed() {
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const { facility, ids } = await createFacility({
    key: "lot", name: "Bench Lot", openTime: "00:00", closeTime: "23:59",
    gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
    zones: [{ key: "z", name: "Zone", slots: Array.from({ length: SLOTS }, (_, i) => ({ key: `s${i}`, number: `S-${i}`, vehicleType: "CAR",
      distance: i })) }],
    rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
  });
  const { user: attendant } = await createAccount({ name: "Bench", email: "bench@example.com", password: "Secret123", role: "ATTENDANT" });
  const { user: driver } = await createAccount({ name: "Driver", email: "driver@example.com", password: "Secret123" });

  // History: registered vehicles, closed stays with payments, and bookings across the slots
  const day = 86400000;
  const now = Date.now();
  await Vehicle.insertMany(Array.from({ length: 2000 }, (_, i) => ({ owner: driver._id, plateNumber: `KA09RV${String(i).padStart(4, "0")}`,
    vehicleType: "CAR" })));
  for (let start = 0; start < history; start += 5000) {
    const batch = Array.from({ length: Math.min(5000, history - start) }, (_, k) => {
      const i = start + k;
      const entryTime = new Date(now - (i % 300) * day - 3 * 3600000);
      return { _id: new mongoose.Types.ObjectId(), facility: facility._id, zone: ids.z, slot: ids[`s${i % SLOTS}`], entryGate: ids.in,
        exitGate: ids.out, plateNumber: `KA08HX${String(i).padStart(5, "0")}`, vehicleType: "CAR", source: "ANPR", entryTime,
        exitTime: new Date(entryTime.getTime() + 7200000), ratePerHour: 40, duration: 120, amount: 80, paid: 80, status: "CLOSED" };
    });
    await Session.insertMany(batch);
    await Payment.insertMany(batch.map((s) => ({ session: s._id, facility: facility._id, method: "AT_GATE", amount: 80, status: "CONFIRMED",
      gatewayRef: `pay_${s._id}`, quotedAt: s.exitTime, confirmedAt: s.exitTime })));
    await Reservation.insertMany(batch.slice(0, 1000).map((s, k) => ({ slot: s.slot, facility: facility._id, startTime: s.entryTime,
      endTime: s.exitTime, status: k % 3 ? "COMPLETED" : "EXPIRED", holdExpiresAt: s.entryTime })));
  }
  return { ids, token: signToken(attendant) };
}

async function main() {
  const url = new URL(config.mongoUrl);
  if (url.pathname.length < 2) url.pathname = "/vps_bench";
  await mongoose.connect(url.toString());
  const { ids, token } = await seed();
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers } });
    return { status: res.status, body: await res.json() };
  };
  const timings = { Entry: [], Payment: [], Webhook: [], Exit: [] };
  const timed = async (label, fn) => {
    const started = performance.now();
    const res = await fn();
    timings[label].push(performance.now() - started);
    return res;
  };

  let failures = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: lanes }, async (_, lane) => {
    for (let c = 0; c < cycles; c++) {
      const plateNumber = `KA01B${String(lane).padStart(3, "0")}${String(c).padStart(2, "0")}`;
      const entry = await timed("Entry", () => call("POST", "/api/entry", { gateId: ids.in, source: "ANPR", plateNumber, vehicleType: "CAR" }));
      if (entry.status !== 201) { failures++; continue; }
      const pay = await timed("Payment", () => call("POST", "/api/payments", { sessionId: entry.body.sessionId, method: "AT_GATE",
        gatewayToken: "tok_bench" }));
      const hook = JSON.stringify({ paymentId: pay.body.paymentId, status: "CONFIRMED" });
      const signature = crypto.createHmac("sha256", config.paymentWebhookSecret).update(hook).digest("hex");
      await timed("Webhook", () => call("POST", "/api/payments/webhook", hook, { "x-razorpay-signature": signature }));
      const exit = await timed("Exit", () => call("POST", "/api/exit", { gateId: ids.out, sessionId: entry.body.sessionId }));
      if (exit.status !== 200) failures++;
    }
  }));
  const seconds = (performance.now() - started) / 1000;

  console.log(`${lanes} lanes × ${cycles} cycles, ${history} past stays, ${SLOTS} slots: ${seconds.toFixed(1)} s, ${failures} failed`);
  console.log("step      n     p50 ms   p90 ms   p99 ms");
  for (const [label, values] of Object.entries(timings)) {
    const sorted = values.sort((a, b) => a - b);
    console.log(`${label.padEnd(8)} ${String(sorted.length).padStart(4)} ${[0.5, 0.9, 0.99].map((q) => p(sorted, q).toFixed(1).padStart(8)).join(" ")}`);
  }
  server.closeAllConnections();
  server.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
