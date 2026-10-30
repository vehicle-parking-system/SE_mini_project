// Payment verification before the exit barrier opens (VPS-F-011) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const crypto = require("crypto");
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const config = require("../src/config");
const hardware = require("../src/hardware");
const Payment = require("../src/models/Payment");
const Session = require("../src/models/Session");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const minutesLater = (m) => new Date(Date.parse(NOW) + m * 60000);

const lot = {
  key: "lot", name: "Lot", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [
    { key: "a1", number: "A-01", vehicleType: "CAR", distance: 1 },
    { key: "a2", number: "A-02", vehicleType: "CAR", distance: 2 },
  ] }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
};

describeDb("payment verification at the exit", () => {
  let server, api;
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const enter = (plateNumber) => api.post("/api/entry").set(as("attendant"))
    .send({ gateId: ids.in, source: "ANPR", plateNumber, vehicleType: "CAR" });
  const exit = (sessionId) => api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId });
  const pay = (sessionId, key = "attendant", method = key === "driver" ? "ONLINE" : "AT_GATE") =>
    api.post("/api/payments").set(as(key)).send({ sessionId, method, gatewayToken: "tok_sandbox_visa" });
  const webhook = (payload, secret = config.paymentWebhookSecret) => {
    const body = JSON.stringify(payload);
    return api.post("/api/payments/webhook").set("content-type", "application/json")
      .set("x-razorpay-signature", crypto.createHmac("sha256", secret).update(body).digest("hex")).send(body);
  };
  const opens = () => hardware.sent().filter((c) => c.gateId === ids.out && c.command === "OPEN").length;

  beforeAll(async () => {
    server = createApp().listen(0);
    api = request(server);
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_payments";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    hardware.clear();
    ids = (await createFacility(lot)).ids;
    const { user: driver } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123",
      vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }] });
    const { user: other } = await createAccount({ name: "Oth", email: "oth@example.com", password: "Secret123" });
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    Object.assign(tokens, { driver: signToken(driver), other: signToken(other), attendant: signToken(attendant) });
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("the barrier opens only after the gateway confirms a payment covering the fee", async () => {
    const { sessionId } = (await enter("KA05XY0001")).body;
    clock.set(minutesLater(90));
    expect((await exit(sessionId)).body).toEqual(expect.objectContaining({ amount: 80, paymentStatus: "UNPAID" }));

    const payment = await pay(sessionId);
    expect(payment.status).toBe(201);
    expect(payment.body).toEqual(expect.objectContaining({ sessionId, method: "AT_GATE", amount: 80, status: "PENDING",
      gatewayRef: expect.stringMatching(/^pay_[0-9a-f]{20}$/) }));
    const waiting = await exit(sessionId);
    expect(waiting.status).toBe(402);
    expect(waiting.body.paymentStatus).toBe("PENDING");
    expect(hardware.sent().at(-1)).toEqual(expect.objectContaining({ command: "DISPLAY", message: "Waiting for payment confirmation" }));
    expect(opens()).toBe(0);

    expect((await webhook({ paymentId: payment.body.paymentId, status: "CONFIRMED" })).body.status).toBe("CONFIRMED");
    const done = await exit(sessionId);
    expect(done.status).toBe(200);
    expect(done.body).toEqual(expect.objectContaining({ sessionId, plateNumber: "KA05XY0001", duration: 90, chargedHours: 2,
      amount: 80, paid: 80, paymentStatus: "CONFIRMED", exitTime: expect.stringMatching(/^2026-11-02T06:00:0/) })); // 11:30 IST
    expect(opens()).toBe(1);
    const session = await Session.findById(sessionId);
    expect(session).toEqual(expect.objectContaining({ status: "CLOSED", duration: 90, amount: 80, paid: 80 }));
    expect(session.exitGate.toString()).toBe(ids.out);
  });

  test("the payment record holds the gateway's reference, never the token", async () => {
    const { sessionId } = (await enter("KA05XY0001")).body;
    await pay(sessionId);
    const stored = JSON.stringify(await Payment.find().lean());
    expect(stored).not.toContain("tok_sandbox_visa");
    expect(stored).toContain("pay_");
  });

  test("a forged or missing signature is rejected (401) and changes nothing", async () => {
    const { sessionId } = (await enter("KA05XY0001")).body;
    const payment = await pay(sessionId);
    expect((await webhook({ paymentId: payment.body.paymentId, status: "CONFIRMED" }, "wrong-secret")).status).toBe(401);
    expect((await api.post("/api/payments/webhook").send({ paymentId: payment.body.paymentId, status: "CONFIRMED" })).status).toBe(401);
    expect((await Payment.findById(payment.body.paymentId)).status).toBe("PENDING");
    expect((await exit(sessionId)).status).toBe(402);
  });

  test("a replayed or late event changes nothing; a failed payment leaves the fee unpaid", async () => {
    const { sessionId } = (await enter("KA05XY0001")).body;
    const first = await pay(sessionId);
    await webhook({ paymentId: first.body.paymentId, status: "FAILED" });
    expect((await webhook({ paymentId: first.body.paymentId, status: "CONFIRMED" })).body.status).toBe("IGNORED");
    expect((await exit(sessionId)).body.paymentStatus).toBe("UNPAID");

    const second = await pay(sessionId);
    expect(second.body.paymentId).not.toBe(first.body.paymentId);
    await webhook({ paymentId: second.body.paymentId, status: "CONFIRMED" });
    expect((await webhook({ paymentId: second.body.paymentId, status: "CONFIRMED" })).body.status).toBe("IGNORED");
    expect(await Payment.countDocuments({ status: "CONFIRMED" })).toBe(1);
    expect((await webhook({ paymentId: new mongoose.Types.ObjectId().toString(), status: "CONFIRMED" })).status).toBe(404);
  });

  test("paying twice before confirmation returns the same payment; once covered there is nothing to pay", async () => {
    const { sessionId } = (await enter("KA05XY0001")).body;
    const first = await pay(sessionId);
    expect((await pay(sessionId)).body.paymentId).toBe(first.body.paymentId);
    await webhook({ paymentId: first.body.paymentId, status: "CONFIRMED" });
    const session = await api.get(`/api/sessions/${sessionId}`).set(as("attendant"));
    expect(session.body.fee).toEqual(expect.objectContaining({ amount: 0, total: 40, paid: 40, paymentStatus: "PAID" }));
    const again = await pay(sessionId);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/nothing to pay/i);
  });

  test("after paying, the driver has the grace period to leave; later, the extra time must be paid", async () => {
    const { sessionId } = (await enter("KA05XY0001")).body;
    clock.set(minutesLater(55));
    const payment = await pay(sessionId);
    await webhook({ paymentId: payment.body.paymentId, status: "CONFIRMED" });
    clock.set(minutesLater(55 + 16)); // grace (15 min) over, and now into the second hour
    const late = await exit(sessionId);
    expect(late.status).toBe(402);
    expect(late.body).toEqual(expect.objectContaining({ amount: 40, total: 80, paid: 40 }));

    const { sessionId: second } = (await enter("KA05XY0002")).body;
    clock.set(minutesLater(55 + 16 + 50));
    const p2 = await pay(second);
    await webhook({ paymentId: p2.body.paymentId, status: "CONFIRMED" });
    clock.set(minutesLater(55 + 16 + 50 + 14)); // past the hour, but within grace
    expect((await exit(second)).status).toBe(200);
  });

  test("simultaneous exits of a paid vehicle open the barrier once", async () => {
    const { sessionId } = (await enter("KA05XY0001")).body;
    const payment = await pay(sessionId);
    await webhook({ paymentId: payment.body.paymentId, status: "CONFIRMED" });
    const results = await Promise.all([exit(sessionId), exit(sessionId), exit(sessionId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(opens()).toBe(1);
  });

  test("drivers pay online for their own session only; attendants take payment at the gate", async () => {
    const { sessionId } = (await enter("KA01AB1234")).body;
    expect((await pay(sessionId, "other", "ONLINE")).status).toBe(404);
    expect((await pay(sessionId, "driver", "AT_GATE")).status).toBe(400);
    expect((await pay(sessionId, "attendant", "ONLINE")).status).toBe(400);
    const online = await pay(sessionId, "driver");
    expect(online.status).toBe(201);
    expect((await api.get(`/api/payments/${online.body.paymentId}`).set(as("driver"))).body.status).toBe("PENDING");
    expect((await api.get(`/api/payments/${online.body.paymentId}`).set(as("other"))).status).toBe(404);
  });

  test("invalid payment requests are 400", async () => {
    const res = await api.post("/api/payments").set(as("attendant")).send({ sessionId: "x", method: "CASH", gatewayToken: "4111" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details).sort()).toEqual(["gatewayToken", "method", "sessionId"]);
  });

  test("the sandbox gateway confirms its own payments when auto-confirm is on", async () => {
    config.paymentSandboxAutoConfirm = true;
    try {
      const { sessionId } = (await enter("KA05XY0001")).body;
      const payment = await pay(sessionId);
      let status = "PENDING";
      for (let i = 0; i < 40 && status === "PENDING"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = (await Payment.findById(payment.body.paymentId)).status;
      }
      expect(status).toBe("CONFIRMED");
    } finally {
      config.paymentSandboxAutoConfirm = false;
    }
  });
});
