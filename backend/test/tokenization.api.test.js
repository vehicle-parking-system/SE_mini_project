// Secure payment tokenization (VPS-SR-004), booking payments and refunds (VPS-F-030 to VPS-F-032).
// The card-data checks are pure; the rest runs against a real MongoDB (MONGO_URL, own database
// name; skipped when it is not set).
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const notifications = require("../src/notifications");
const payments = require("../src/payments");
const qr = require("../src/qr");
const { containsCardData, looksLikeCardNumber } = require("../src/middleware/cardData");
const Payment = require("../src/models/Payment");
const Reservation = require("../src/models/Reservation");

describe("card data detection", () => {
  test.each(["4111111111111111", "4111 1111 1111 1111", "5555-5555-5555-4444", "378282246310005", 4111111111111111])(
    "%s is a card number", (value) => expect(looksLikeCardNumber(value)).toBe(true));

  test.each(["4111111111111112", "9876543210", "1730000000000", "KA01AB1234", "2026-11-02T10:00:00+05:30", "tok_sandbox_visa"])(
    "%s is not", (value) => expect(looksLikeCardNumber(value)).toBe(false));

  test("card fields or card numbers anywhere in a body are found", () => {
    expect(containsCardData({ cardNumber: "x" })).toBe(true);
    expect(containsCardData({ payment: { cvv: "123" } })).toBe(true);
    expect(containsCardData({ "card-number": "4111" })).toBe(true);
    expect(containsCardData({ notes: ["call me", "4111 1111 1111 1111"] })).toBe(true);
    expect(containsCardData({ sessionId: "6aded1a7144f758e4730b6ca", gatewayToken: "tok_x", phone: "9876543210" })).toBe(false);
    expect(containsCardData({ cvv: "" })).toBe(false);
  });
});

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const at = (time) => `2026-11-02T${time}:00+05:30`;

const lot = {
  key: "lot", name: "Lot", openTime: "06:00", closeTime: "23:00", refundPolicy: { fullRefundIfCancelledMinutesBefore: 60 },
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [{ key: "a1", number: "A-01", vehicleType: "CAR", distance: 1 },
    { key: "a2", number: "A-02", vehicleType: "CAR", distance: 2 }] }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
};

describeDb("booking payments, refunds and the transaction log", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const book = (start, end) => api.post("/api/reservations").set(as("driver"))
    .send({ vehicleId: ids.car, facilityId: ids.lot, startTime: at(start), endTime: at(end) });
  const payBooking = (reservationId) => api.post("/api/payments").set(as("driver"))
    .send({ reservationId, method: "ONLINE", gatewayToken: "tok_sandbox_visa" });
  const confirm = (paymentId) => payments.handleGatewayEvent({ paymentId, status: "CONFIRMED" });
  const reservation = async (id) => (await api.get(`/api/reservations/${id}`).set(as("driver"))).body;
  const transactions = async (query = "") => (await api.get(`/api/admin/transactions${query}`).set(as("admin"))).body.transactions;

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_tokenization";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(at("10:00")));
    notifications.clear();
    ids = (await createFacility(lot)).ids;
    const { user: driver, vehicles } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123",
      vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }] });
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    const { user: admin } = await createAccount({ name: "Adm", email: "adm@example.com", password: "Secret123", role: "ADMIN" });
    Object.assign(tokens, { driver: signToken(driver), attendant: signToken(attendant), admin: signToken(admin) });
    ids.car = vehicles[0].id;
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  describe("tokenization", () => {
    test("a request carrying card data is refused before any route runs, and nothing is stored", async () => {
      const r = await book("14:00", "16:00");
      const res = await api.post("/api/payments").set(as("driver")).send({ reservationId: r.body.reservationId, method: "ONLINE",
        gatewayToken: "tok_sandbox_visa", cardNumber: "4111111111111111", cvv: "123" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CARD_DATA_REJECTED");
      // even unauthenticated, and on any endpoint
      expect((await api.post("/api/auth/register").send({ name: "X", card: { number: "4111111111111111" } })).status).toBe(400);
      expect(await Payment.countDocuments()).toBe(0);
    });

    test("payments store only the gateway reference: no token, no card data", async () => {
      const r = await book("14:00", "16:00");
      await confirm((await payBooking(r.body.reservationId)).body.paymentId);
      const dump = JSON.stringify(await mongoose.connection.db.collection("payments").find().toArray());
      expect(dump).not.toContain("tok_sandbox_visa");
      expect(dump).toMatch(/"gatewayRef":"pay_[0-9a-f]{20}"/);
    });
  });

  describe("paying for a booking online", () => {
    test("the booking's price is its window at the rate; it is CONFIRMED only by the gateway's confirmation", async () => {
      const r = await book("14:00", "15:30");
      expect(r.body.price).toBe(80);
      const payment = await payBooking(r.body.reservationId);
      expect(payment.status).toBe(201);
      expect(payment.body).toEqual(expect.objectContaining({ type: "PAYMENT", reservationId: r.body.reservationId, amount: 80, status: "PENDING" }));
      expect((await reservation(r.body.reservationId)).status).toBe("HELD");

      await confirm(payment.body.paymentId);
      const confirmed = await reservation(r.body.reservationId);
      expect(confirmed.status).toBe("CONFIRMED");
      expect(confirmed.refundableUntil).toBe(new Date(at("13:00")).toISOString());
      expect(notifications.sent()).toEqual(expect.arrayContaining([
        expect.objectContaining({ to: "drv@example.com", type: "BOOKING_CONFIRMED", data: expect.objectContaining({ amount: 80 }) })]));
      expect((await payBooking(r.body.reservationId)).status).toBe(409); // already paid
    });

    test("only the booking's driver pays, online", async () => {
      const r = await book("14:00", "15:00");
      const atGate = await api.post("/api/payments").set(as("attendant"))
        .send({ reservationId: r.body.reservationId, method: "AT_GATE", gatewayToken: "tok_x" });
      expect(atGate.status).toBe(404);
    });

    test("a paid booking needs no payment at the exit while the stay fits its window; overstaying costs the difference", async () => {
      const r = await book("10:00", "12:00");
      await confirm((await payBooking(r.body.reservationId)).body.paymentId);
      const entry = await api.post("/api/entry").set(as("attendant")).send({ gateId: ids.in, source: "QR", qrCode: r.body.qrCode });
      clock.set(new Date(at("11:50")));
      expect((await api.get(`/api/sessions/${entry.body.sessionId}`).set(as("attendant"))).body.fee)
        .toEqual(expect.objectContaining({ amount: 0, total: 80, paid: 80, paymentStatus: "PAID" }));
      clock.set(new Date(at("12:30")));
      const exit = await api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId: entry.body.sessionId });
      expect(exit.status).toBe(402);
      expect(exit.body).toEqual(expect.objectContaining({ amount: 40, total: 120, paid: 80 }));
    });

    test("a payment confirmed after the booking lapsed is refunded automatically", async () => {
      const r = await book("10:30", "11:00");
      const payment = await payBooking(r.body.reservationId);
      clock.set(new Date(at("10:50"))); // hold lapsed at 10:45
      await api.get(`/api/reservations/${r.body.reservationId}`).set(as("driver"));
      await confirm(payment.body.paymentId);
      expect((await reservation(r.body.reservationId)).status).toBe("EXPIRED");
      expect((await transactions("?type=REFUND")).map((t) => [t.refundOf, t.amount, t.status]))
        .toEqual([[payment.body.paymentId, 40, "PROCESSED"]]);
    });
  });

  describe("refund policy", () => {
    test("cancelled at least 60 minutes before the start: REFUNDED in full, with a refund transaction", async () => {
      const r = await book("14:00", "16:00");
      const payment = await payBooking(r.body.reservationId);
      await confirm(payment.body.paymentId);
      clock.set(new Date(at("12:59")));
      const cancelled = await api.post(`/api/reservations/${r.body.reservationId}/cancel`).set(as("driver"));
      expect(cancelled.body.status).toBe("REFUNDED");
      const refund = (await transactions("?type=REFUND"))[0];
      expect(refund).toEqual(expect.objectContaining({ type: "REFUND", refundOf: payment.body.paymentId, amount: 80,
        status: "PROCESSED", gatewayRef: expect.stringMatching(/^rfnd_/) }));
    });

    test("cancelled later: CANCELLED, no refund; an unpaid booking is simply cancelled", async () => {
      const late = await book("14:00", "16:00");
      await confirm((await payBooking(late.body.reservationId)).body.paymentId);
      clock.set(new Date(at("13:01")));
      expect((await api.post(`/api/reservations/${late.body.reservationId}/cancel`).set(as("driver"))).body.status).toBe("CANCELLED");
      const unpaid = await book("18:00", "19:00");
      expect((await api.post(`/api/reservations/${unpaid.body.reservationId}/cancel`).set(as("driver"))).body.status).toBe("CANCELLED");
      expect(await transactions("?type=REFUND")).toEqual([]);
    });
  });

  describe("transaction log", () => {
    test("admins see every payment and refund with its gateway reference; nobody else can", async () => {
      const r = await book("14:00", "16:00");
      await confirm((await payBooking(r.body.reservationId)).body.paymentId);
      await api.post(`/api/reservations/${r.body.reservationId}/cancel`).set(as("driver"));
      const log = await transactions();
      expect(log.map((t) => [t.type, t.status])).toEqual([["REFUND", "PROCESSED"], ["PAYMENT", "CONFIRMED"]]);
      for (const t of log) {
        expect(t).toEqual(expect.objectContaining({ gatewayRef: expect.any(String), amount: 80, createdAt: expect.any(String) }));
      }
      expect((await api.get("/api/admin/transactions").set(as("attendant"))).status).toBe(403);
      expect((await api.get("/api/admin/transactions?from=yesterday").set(as("admin"))).status).toBe(400);
    });

    test("the booking QR still works after paying (it is CONFIRMED, not consumed)", async () => {
      const r = await book("10:00", "11:00");
      await confirm((await payBooking(r.body.reservationId)).body.paymentId);
      expect(qr.readBookingCode(r.body.qrCode)).toBe(r.body.reservationId);
      expect((await Reservation.findById(r.body.reservationId)).status).toBe("CONFIRMED");
      const entry = await api.post("/api/entry").set(as("attendant")).send({ gateId: ids.in, source: "QR", qrCode: r.body.qrCode });
      expect(entry.status).toBe(201);
    });
  });
});
