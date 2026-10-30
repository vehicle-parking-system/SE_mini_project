// Exit receipts (VPS-F-013) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const notifications = require("../src/notifications");
const payments = require("../src/payments");
const Receipt = require("../src/models/Receipt");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const minutesLater = (m) => new Date(Date.parse(NOW) + m * 60000);

const lot = {
  key: "lot", name: "Lot", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [{ key: "a1", number: "A-01", vehicleType: "CAR", distance: 1 },
    { key: "a2", number: "A-02", vehicleType: "CAR", distance: 2 }] }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
};

describeDb("exit receipts", () => {
  let server, api;
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  async function parkPayAndLeave(plateNumber, minutes) {
    clock.set(new Date(NOW));
    const { sessionId } = (await api.post("/api/entry").set(as("attendant"))
      .send({ gateId: ids.in, source: "ANPR", plateNumber, vehicleType: "CAR" })).body;
    clock.set(minutesLater(minutes));
    const payment = await api.post("/api/payments").set(as("attendant")).send({ sessionId, method: "AT_GATE", gatewayToken: "tok_x" });
    await payments.handleGatewayEvent({ paymentId: payment.body.paymentId, status: "CONFIRMED" });
    return { sessionId, payment: payment.body, exit: await api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId }) };
  }

  beforeAll(async () => {
    server = createApp().listen(0);
    api = request(server);
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_receipts";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    notifications.clear();
    ids = (await createFacility(lot)).ids;
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    const { user: driver } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123",
      vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }] });
    const { user: other } = await createAccount({ name: "Oth", email: "oth@example.com", password: "Secret123" });
    Object.assign(tokens, { attendant: signToken(attendant), driver: signToken(driver), other: signToken(other) });
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("every exit issues a numbered receipt that matches the session and payment", async () => {
    const { sessionId, payment, exit } = await parkPayAndLeave("KA05XY0001", 125);
    expect(exit.body.receiptNumber).toMatch(/^VPS-2026-000001$/);
    const receipt = await api.get(`/api/receipts/${exit.body.receiptId}`).set(as("attendant"));
    const session = await api.get(`/api/sessions/${sessionId}`).set(as("attendant"));
    expect(receipt.body).toEqual(expect.objectContaining({
      number: "VPS-2026-000001", sessionId, facilityName: "Lot", timezone: "Asia/Kolkata", plateNumber: "KA05XY0001",
      slotNumber: "A-01", zoneName: "Zone A", entryTime: session.body.entryTime, exitTime: session.body.exitTime,
      duration: 125, chargedHours: 3, ratePerHour: 40, amount: 120,
      payments: [expect.objectContaining({ method: "AT_GATE", amount: 120, gatewayRef: payment.gatewayRef })],
    }));
    expect((await parkPayAndLeave("KA05XY0002", 30)).exit.body.receiptNumber).toBe("VPS-2026-000002");
    expect(await Receipt.countDocuments()).toBe(2);
  });

  test("a registered driver gets the receipt by notification and in their history; others can't read it", async () => {
    const { exit } = await parkPayAndLeave("KA01AB1234", 60);
    expect(notifications.sent()).toEqual(expect.arrayContaining([expect.objectContaining({ to: "drv@example.com",
      type: "EXIT_RECEIPT", data: expect.objectContaining({ receiptId: exit.body.receiptId, amount: 40 }) })]));
    const mine = await api.get("/api/users/me/receipts").set(as("driver"));
    expect(mine.body.receipts.map((r) => r.receiptId)).toEqual([exit.body.receiptId]);
    expect((await api.get(`/api/receipts/${exit.body.receiptId}`).set(as("driver"))).status).toBe(200);
    expect((await api.get(`/api/receipts/${exit.body.receiptId}`).set(as("other"))).status).toBe(404);
    expect((await api.get("/api/users/me/receipts").set(as("other"))).body.receipts).toEqual([]);
    expect((await api.get("/api/receipts/nope").set(as("attendant"))).status).toBe(404);
  });
});
