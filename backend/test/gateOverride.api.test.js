// Occupancy monitoring and manual gate override (VPS-F-042), and gate commands queued through a
// network loss (SAD §3.7), against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const hardware = require("../src/hardware");
const AuditLog = require("../src/models/AuditLog");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lot = {
  key: "lot", name: "Lot", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "in", name: "North In", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [
    { key: "a1", number: "A-01", vehicleType: "CAR", distance: 1 }, { key: "a2", number: "A-02", vehicleType: "CAR", distance: 2 },
  ] }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
};

describeDb("gate override and network loss", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const commands = (gateId, command) => hardware.sent().filter((c) => c.gateId === gateId && (!command || c.command === command));
  async function until(check, ms = 5000) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (check()) return true;
    return check();
  }

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_gate_override";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    hardware.clear();
    clock.set(new Date("2026-11-02T10:00:00+05:30"));
    ids = (await createFacility(lot)).ids;
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    const { user: admin } = await createAccount({ name: "Adm", email: "adm@example.com", password: "Secret123", role: "ADMIN" });
    const { user: driver } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123" });
    Object.assign(tokens, { attendant: signToken(attendant), admin: signToken(admin), driver: signToken(driver) });
    tokens.attendantId = attendant.id;
  });
  afterAll(async () => {
    hardware.clear();
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("an attendant opens a barrier by hand; the override is audited with who, where and why", async () => {
    const res = await api.post(`/api/gates/${ids.out}/override`).set(as("attendant"))
      .send({ action: "OPEN", reason: "PAYMENT_TERMINAL_FAILURE", note: "Card reader offline" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ gateId: ids.out, action: "OPEN", delivered: true, online: true, queued: 0 }));
    expect(commands(ids.out, "OPEN")).toHaveLength(1);

    const log = await AuditLog.findById(res.body.logId);
    expect(log).toEqual(expect.objectContaining({ event: "MANUAL_OVERRIDE", actorEmail: "att@example.com" }));
    expect(log.actorId.toString()).toBe(tokens.attendantId);
    expect(log.details).toEqual(expect.objectContaining({ kind: "BARRIER", action: "OPEN", reason: "PAYMENT_TERMINAL_FAILURE",
      note: "Card reader offline", gateId: ids.out, facilityId: ids.lot }));

    const shiftLog = await api.get(`/api/gates/overrides?facilityId=${ids.lot}`).set(as("attendant"));
    expect(shiftLog.body.logs).toEqual([expect.objectContaining({ actorEmail: "att@example.com", event: "MANUAL_OVERRIDE" })]);
  });

  test("an override needs a known action and reason; drivers can't override", async () => {
    const bad = await api.post(`/api/gates/${ids.in}/override`).set(as("attendant")).send({ action: "LIFT", reason: "OTHER" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(["action", "note"]);
    expect((await api.post(`/api/gates/${ids.in}/override`).set(as("driver")).send({ action: "OPEN", reason: "EMERGENCY" })).status).toBe(403);
    expect((await api.get("/api/gates/status").set(as("driver"))).status).toBe(403);
    expect(hardware.sent()).toEqual([]);
    expect(await AuditLog.countDocuments({ event: "MANUAL_OVERRIDE" })).toBe(0);
  });

  test("a vehicle admitted on a typed-in plate is recorded as a manual override", async () => {
    const enter = (source, plateNumber, vehicleType = "CAR") => api.post("/api/entry").set(as("attendant"))
      .send({ gateId: ids.in, source, plateNumber, vehicleType });
    expect((await enter("ANPR", "KA01AA0001")).status).toBe(201);
    expect((await enter("MANUAL", "KA01AA0002", "BIKE")).status).toBe(409); // no bike slot: a refusal isn't an override
    expect(await AuditLog.countDocuments({ event: "MANUAL_OVERRIDE" })).toBe(0);

    const manual = await enter("MANUAL", "KA01AA0003");
    expect(manual.status).toBe(201);
    const logs = await AuditLog.find({ event: "MANUAL_OVERRIDE" });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorEmail).toBe("att@example.com");
    expect(logs[0].details).toEqual(expect.objectContaining({ kind: "MANUAL_ENTRY", sessionId: manual.body.sessionId,
      plateNumber: "KA01AA0003", gateId: ids.in, facilityId: ids.lot }));
  });

  test("commands are queued while a gate's link is down and delivered once, in order, when it returns", async () => {
    hardware.setLink(ids.in, false);
    const entry = await api.post("/api/entry").set(as("attendant")).send({ gateId: ids.in, source: "ANPR", plateNumber: "KA01AA0001", vehicleType: "CAR" });
    expect(entry.status).toBe(201); // the session exists even though the barrier hasn't moved yet
    expect(commands(ids.in)).toEqual([]);

    const status = await api.get(`/api/gates/status?facilityId=${ids.lot}`).set(as("attendant"));
    expect(status.body.gates.find((g) => g.id === ids.in)).toEqual(expect.objectContaining({ name: "North In", online: false, queued: 2 }));
    expect(status.body.gates.find((g) => g.id === ids.out)).toEqual(expect.objectContaining({ online: true, queued: 0 }));

    const override = await api.post(`/api/gates/${ids.in}/override`).set(as("attendant")).send({ action: "OPEN", reason: "BARRIER_FAULT" });
    expect(override.body).toEqual(expect.objectContaining({ delivered: false, online: false, queued: 4 }));

    hardware.setLink(ids.in, true);
    expect(await until(() => commands(ids.in).length === 4)).toBe(true);
    expect(commands(ids.in).map((c) => c.command)).toEqual(["DISPLAY", "OPEN", "DISPLAY", "OPEN"]);
    await sleep(600); // nothing is delivered twice
    expect(commands(ids.in)).toHaveLength(4);
    expect(hardware.status([ids.in])[ids.in]).toEqual(expect.objectContaining({ online: true, queued: 0 }));
  });
});
