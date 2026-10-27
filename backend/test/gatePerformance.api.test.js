// Entry/exit performance (VPS-NF-001) against a real MongoDB: allocation stays correct and fast
// under concurrent entries, cached configuration follows admin changes, and gate timings are reported.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const cache = require("../src/cache");
const clock = require("../src/clock");
const hardware = require("../src/hardware");
const metrics = require("../src/metrics");
const payments = require("../src/payments");
const Slot = require("../src/models/Slot");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const SLOTS = 30;

const lot = {
  key: "lot", name: "Lot", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: Array.from({ length: SLOTS }, (_, i) => ({ key: `s${i}`, number: `A-${String(i).padStart(2, "0")}`,
    vehicleType: "CAR", distance: (i * 7) % SLOTS })) }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
};

describeDb("gate performance", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};
  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const enter = (plateNumber) => api.post("/api/entry").set(as("attendant"))
    .send({ gateId: ids.in, source: "ANPR", plateNumber, vehicleType: "CAR" });
  const plate = (i) => `KA01PF${String(i).padStart(4, "0")}`;

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_gate_performance";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    cache.clear();
    hardware.clear();
    metrics.clear();
    clock.set(new Date("2026-11-02T10:00:00+05:30"));
    ids = (await createFacility(lot)).ids;
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    const { user: admin } = await createAccount({ name: "Adm", email: "adm@example.com", password: "Secret123", role: "ADMIN" });
    Object.assign(tokens, { attendant: signToken(attendant), admin: signToken(admin) });
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("simultaneous entries each get a different slot, nearest first, until the lot is full", async () => {
    const results = await Promise.all(Array.from({ length: SLOTS + 10 }, (_, i) => enter(plate(i))));
    const admitted = results.filter((r) => r.status === 201);
    expect(admitted).toHaveLength(SLOTS);
    expect(new Set(admitted.map((r) => r.body.slotId)).size).toBe(SLOTS);
    expect(results.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(Array(10).fill("FACILITY_FULL"));
    expect(await Slot.countDocuments({ status: "OCCUPIED" })).toBe(SLOTS);
    expect(hardware.sent().filter((c) => c.command === "OPEN")).toHaveLength(SLOTS);
  });

  test("with slots to spare, concurrent entries take exactly the nearest ones", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => enter(plate(i))));
    const slots = await Slot.find({ _id: { $in: results.map((r) => r.body.slotId) } });
    expect(slots.map((s) => s.distance).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("entry and exit are timed against the 3 s budget; admins can read the percentiles", async () => {
    const { sessionId } = (await enter(plate(1))).body;
    await api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId }).expect(402);
    const pay = await api.post("/api/payments").set(as("attendant")).send({ sessionId, method: "AT_GATE", gatewayToken: "tok_x" });
    await payments.handleGatewayEvent({ paymentId: pay.body.paymentId, status: "CONFIRMED" });
    await api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId }).expect(200);

    const res = await api.get("/api/admin/metrics/gates").set(as("admin"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ budgetMs: 3000, targetPct: 90 }));
    expect(res.body.entry).toEqual(expect.objectContaining({ count: 1, overBudget: 0, withinBudgetPct: 100, meetsTarget: true }));
    expect(res.body.exit.count).toBe(2); // a refused exit is still a gate transaction
    expect(res.body.exit.p90).toBeLessThan(3000);
    expect((await api.get("/api/admin/metrics/gates").set(as("attendant"))).status).toBe(403);
  });

  test("a configuration change reaches the gates at once, despite the cache", async () => {
    expect((await enter(plate(1))).status).toBe(201); // gate, facility and zone are now cached
    await api.patch(`/api/admin/zones/${ids.zoneA}`).set(as("admin")).send({ name: "Level 2" }).expect(200);
    await enter(plate(2)).expect(201);
    expect(hardware.sent().filter((c) => c.command === "DISPLAY").at(-1).message).toMatch(/· Level 2 ·/);
  });

  test("40 gate lanes in parallel: 90% of entries and exits finish well within the 3 s budget", async () => {
    const lanes = 40;
    await Promise.all(Array.from({ length: lanes }, async (_, i) => {
      const { sessionId } = (await enter(plate(i))).body;
      if (!sessionId) return;
      const pay = await api.post("/api/payments").set(as("attendant")).send({ sessionId, method: "AT_GATE", gatewayToken: "tok_x" });
      await payments.handleGatewayEvent({ paymentId: pay.body.paymentId, status: "CONFIRMED" });
      await api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId });
    }));
    const { entry, exit } = metrics.summary();
    expect(entry.count).toBe(lanes);
    expect(entry.p90).toBeLessThan(1500);
    expect(exit.p90).toBeLessThan(1500);
  });
});
