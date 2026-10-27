// Parking fee calculation (VPS-F-010). Pure fee rules, then rate cards and the exit quote
// against a real MongoDB (MONGO_URL, own database name; skipped when it is not set).
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const hardware = require("../src/hardware");
const pricing = require("../src/pricing");
const Rate = require("../src/models/Rate");
const Session = require("../src/models/Session");

describe("fee rules", () => {
  const t0 = new Date("2026-11-02T10:00:00Z");
  const after = (ms) => new Date(t0.getTime() + ms);

  test("duration is rounded to the nearest minute", () => {
    expect(pricing.durationMinutes(t0, after(59 * 60000 + 29999))).toBe(59);
    expect(pricing.durationMinutes(t0, after(59 * 60000 + 30000))).toBe(60);
    expect(pricing.durationMinutes(t0, after(-5000))).toBe(0);
  });

  test.each([[0, 1], [1, 1], [30, 1], [60, 1], [61, 2], [120, 2], [165, 3]])(
    "%i minutes are charged as %i started hour(s)", (minutes, hours) => {
      expect(pricing.chargedHours(minutes)).toBe(hours);
      expect(pricing.feeFor(minutes, 40)).toBe(hours * 40);
    });

  test("a quote describes the stay up to a moment", () => {
    expect(pricing.quote({ entryTime: t0, ratePerHour: 40 }, after(90 * 60000))).toEqual({
      duration: 90, chargedHours: 2, ratePerHour: 40, amount: 80, quotedAt: after(90 * 60000).toISOString(),
    });
  });
});

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const minutesLater = (m) => new Date(Date.parse(NOW) + m * 60000);

const lot = {
  key: "lot", name: "Lot", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [
    { key: "zoneA", name: "Zone A", slots: [{ key: "a1", number: "A-01", vehicleType: "CAR", distance: 1 }] },
    { key: "zoneB", name: "Zone B", slots: [{ key: "b1", number: "B-01", vehicleType: "CAR", distance: 2 },
      { key: "t1", number: "B-T1", vehicleType: "TRUCK", distance: 3 }] },
  ],
  rates: [{ vehicleType: "CAR", ratePerHour: 30 }, { zone: "zoneA", vehicleType: "CAR", ratePerHour: 50 }],
};
const other = { key: "other", name: "Other", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "otherOut", type: "EXIT" }], zones: [] };

describeDb("rate cards and the exit quote", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  let token;

  const enter = (plateNumber, vehicleType = "CAR") => api.post("/api/entry").set("authorization", `Bearer ${token}`)
    .send({ gateId: ids.in, source: "ANPR", plateNumber, vehicleType });
  const exit = (body) => api.post("/api/exit").set("authorization", `Bearer ${token}`).send({ gateId: ids.out, ...body });

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_fees";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    hardware.clear();
    ids = { ...(await createFacility(lot)).ids, ...(await createFacility(other)).ids };
    const { user } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    token = signToken(user);
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("a zone's own rate wins over the facility-wide rate; no rate means free", async () => {
    expect(await pricing.rateFor(ids.lot, ids.zoneA, "CAR")).toBe(50);
    expect(await pricing.rateFor(ids.lot, ids.zoneB, "CAR")).toBe(30);
    expect(await pricing.rateFor(ids.lot, ids.zoneB, "TRUCK")).toBeNull();
    expect((await enter("KA05XY0001")).body.ratePerHour).toBe(50); // A-01 is nearest
    expect((await enter("KA05XY0002")).body.ratePerHour).toBe(30); // then B-01
    expect((await enter("KA05XY0003", "TRUCK")).body.ratePerHour).toBe(0);
  });

  test("the rate is kept from entry: a later change doesn't affect a vehicle already parked", async () => {
    const entry = await enter("KA05XY0001");
    await Rate.updateOne({ facility: ids.lot, zone: ids.zoneA }, { ratePerHour: 500 });
    clock.set(minutesLater(90));
    expect((await exit({ sessionId: entry.body.sessionId })).body.amount).toBe(100);
  });

  test("unpaid: 402 with the quote, the display asks for payment and the barrier stays closed", async () => {
    const entry = await enter("KA05XY0001");
    clock.set(minutesLater(61));
    const res = await exit({ sessionId: entry.body.sessionId });
    expect(res.status).toBe(402);
    expect(res.body).toEqual(expect.objectContaining({ sessionId: entry.body.sessionId, duration: 61, chargedHours: 2,
      ratePerHour: 50, amount: 100, total: 100, paid: 0, paymentStatus: "UNPAID" }));
    expect(res.body.error.code).toBe("PAYMENT_REQUIRED");
    expect(hardware.sent().filter((c) => c.gateId === ids.out)).toEqual([
      expect.objectContaining({ command: "DISPLAY", message: "Please pay ₹100" })]);
  });

  test("a parked vehicle's session shows what leaving now would cost", async () => {
    const entry = await enter("KA05XY0001");
    clock.set(minutesLater(30));
    const session = await api.get(`/api/sessions/${entry.body.sessionId}`).set("authorization", `Bearer ${token}`);
    expect(session.body.fee).toEqual(expect.objectContaining({ duration: 30, amount: 50, total: 50, paid: 0, paymentStatus: "UNPAID" }));
  });

  test("the vehicle can be found by session, entry ticket or plate", async () => {
    const entry = await enter("KA05XY0001");
    for (const by of [{ sessionId: entry.body.sessionId }, { qrCode: entry.body.ticketQr }, { plateNumber: "ka05xy0001" }]) {
      const res = await exit(by);
      expect(res.status).toBe(402);
      expect(res.body.sessionId).toBe(entry.body.sessionId);
    }
  });

  test("bad requests: 400 fields or ticket, 404 gate or session, 409 wrong facility or already left", async () => {
    const entry = await enter("KA05XY0001");
    expect((await exit({})).body.error.details).toEqual({ sessionId: "Scan the ticket, or give the session or number plate" });
    expect((await exit({ qrCode: "fake" })).body.error.message).toBe("Invalid ticket");
    expect((await exit({ gateId: ids.in, sessionId: entry.body.sessionId })).status).toBe(404);
    expect((await exit({ sessionId: new mongoose.Types.ObjectId().toString() })).status).toBe(404);
    expect((await exit({ plateNumber: "KA05XY9999" })).status).toBe(404);
    expect((await exit({ gateId: ids.otherOut, sessionId: entry.body.sessionId })).status).toBe(409);
    await Session.updateOne({ _id: entry.body.sessionId }, { status: "CLOSED" });
    expect((await exit({ sessionId: entry.body.sessionId })).body.error.message).toBe("This vehicle has already left");
  });
});
