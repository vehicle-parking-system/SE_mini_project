// Occupancy, revenue and usage reports (VPS-F-043) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const payments = require("../src/payments");
const Payment = require("../src/models/Payment");
const Reservation = require("../src/models/Reservation");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const at = (date, time) => new Date(`2026-11-${date}T${time}:00+05:30`);

const lot = {
  key: "lot", name: "Main Lot", openTime: "06:00", closeTime: "22:00",
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [
    { key: "a1", number: "A-01", vehicleType: "CAR", distance: 1 }, { key: "a2", number: "A-02", vehicleType: "CAR", distance: 2 },
    { key: "b1", number: "B-01", vehicleType: "BIKE", distance: 3 }, { key: "off", number: "X-01", vehicleType: "CAR", status: "INACTIVE" },
  ] }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }, { vehicleType: "BIKE", ratePerHour: 20 }],
};

describeDb("reports", () => {
  let server, api;
  let ids;
  const tokens = {};
  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const report = (type, query) => api.get(`/api/reports/${type}`).set(as("admin")).query({ facilityId: ids.lot, ...query });

  // A stay from entry to a paid exit, all through the API
  async function stay(plateNumber, vehicleType, source, from, until) {
    clock.set(from);
    const { sessionId } = (await api.post("/api/entry").set(as("attendant"))
      .send({ gateId: ids.in, source, plateNumber, vehicleType }).expect(201)).body;
    clock.set(until);
    const pay = await api.post("/api/payments").set(as("attendant")).send({ sessionId, method: "AT_GATE", gatewayToken: "tok_x" });
    await payments.handleGatewayEvent({ paymentId: pay.body.paymentId, status: "CONFIRMED" });
    await api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId }).expect(200);
  }

  beforeAll(async () => {
    server = createApp().listen(0);
    api = request(server);
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_reports";
    await mongoose.connect(url.toString());
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    ids = (await createFacility(lot)).ids;
    const { user: admin } = await createAccount({ name: "Adm", email: "adm@example.com", password: "Secret123", role: "ADMIN" });
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    Object.assign(tokens, { admin: signToken(admin), attendant: signToken(attendant) });

    // 2 Nov: a car 10:00–11:30 (₹80) and a bike typed in by hand 10:30–12:30 (₹40)
    await stay("KA01AA0001", "CAR", "ANPR", at("02", "10:00"), at("02", "11:30"));
    await stay("KA01AA0002", "BIKE", "MANUAL", at("02", "10:30"), at("02", "12:30"));
    // 3 Nov: a car 09:00–10:00 (₹40); a booking paid online (₹60) and refunded the same day
    await stay("KA01AA0003", "CAR", "ANPR", at("03", "09:00"), at("03", "10:00"));
    const booking = await Reservation.create({ slot: ids.a2, facility: ids.lot, startTime: at("03", "14:00"), endTime: at("03", "15:30"),
      status: "REFUNDED" });
    const paid = await Payment.create({ reservation: booking._id, facility: ids.lot, method: "ONLINE", amount: 60, status: "CONFIRMED",
      gatewayRef: "pay_b1", quotedAt: at("03", "08:00"), confirmedAt: at("03", "08:00") });
    await Payment.create({ type: "REFUND", refundOf: paid._id, reservation: booking._id, facility: ids.lot, method: "ONLINE", amount: 60,
      status: "PROCESSED", gatewayRef: "rfnd_b1", quotedAt: at("03", "09:00"), confirmedAt: at("03", "09:00") });
    // never paid: doesn't count
    await Payment.create({ session: new mongoose.Types.ObjectId(), facility: ids.lot, method: "AT_GATE", amount: 999, status: "PENDING",
      gatewayRef: "pay_p", quotedAt: at("03", "11:00") });
    clock.set(at("04", "12:00"));
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("revenue: confirmed payments less refunds, per local day", async () => {
    const res = await report("revenue", { from: "2026-11-02", to: "2026-11-03" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ type: "revenue", from: "2026-11-02", to: "2026-11-03", total: 160,
      facility: expect.objectContaining({ id: ids.lot, name: "Main Lot", timezone: "Asia/Kolkata" }) }));
    expect(res.body.days).toEqual([
      { date: "2026-11-02", payments: 2, gross: 120, refunds: 0, refunded: 0, net: 120, atGate: 120, online: 0, parking: 120, bookings: 0 },
      { date: "2026-11-03", payments: 2, gross: 100, refunds: 1, refunded: 60, net: 40, atGate: 40, online: 60, parking: 40, bookings: 60 },
    ]);
    expect(res.body.totals).toEqual(expect.objectContaining({ payments: 4, gross: 220, refunded: 60, net: 160 }));
  });

  test("occupancy: average share of slots in use over opening hours, peak and turnover", async () => {
    const res = await report("occupancy", { from: "2026-11-02", to: "2026-11-04" });
    const [nov2, nov3, nov4] = res.body.days;
    // 3 slots in use (X-01 is inactive) × 16 opening hours; 1.5 h + 2 h parked
    expect(nov2).toEqual({ date: "2026-11-02", capacity: 3, openHours: 16, entries: 2, exits: 2, peakOccupied: 2, occupiedHours: 3.5,
      averageOccupancyPct: 7.3, turnover: 0.67 });
    expect(nov3).toEqual(expect.objectContaining({ entries: 1, peakOccupied: 1, occupiedHours: 1, averageOccupancyPct: 2.1 }));
    // 4 Nov is still in progress at 12:00: nobody parked so far
    expect(nov4).toEqual(expect.objectContaining({ entries: 0, peakOccupied: 0, averageOccupancyPct: 0 }));
    expect(res.body.totals).toEqual(expect.objectContaining({ capacity: 3, entries: 3, exits: 3, peakOccupied: 2, occupiedHours: 4.5,
      turnover: 1 }));
  });

  test("usage: how vehicles came in, how long they stayed and what became of bookings", async () => {
    const res = await report("usage", { from: "2026-11-02", to: "2026-11-03" });
    expect(res.body.days[0]).toEqual(expect.objectContaining({ date: "2026-11-02", entries: 2, anpr: 1, qr: 0, manual: 1, walkIns: 2,
      booked: 0, car: 1, bike: 1, truck: 0, exits: 2, averageStayMinutes: 105, bookings: 0 }));
    expect(res.body.days[1]).toEqual(expect.objectContaining({ entries: 1, bookings: 1, bookingsCancelled: 1, averageStayMinutes: 60 }));
    expect(res.body.totals.entriesByHour[10]).toBe(2);
    expect(res.body.totals.entriesByHour[9]).toBe(1);
  });

  test("every report exports as CSV: a header, a row per day and a TOTAL row", async () => {
    for (const type of ["occupancy", "revenue", "usage"]) {
      const res = await report(type, { from: "2026-11-02", to: "2026-11-03", format: "csv" });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/csv/);
      expect(res.headers["content-disposition"]).toBe(`attachment; filename="${type}-main-lot-2026-11-02-to-2026-11-03.csv"`);
      const lines = res.text.trim().split("\r\n");
      expect(lines).toHaveLength(4);
      expect(lines[0].startsWith("date,")).toBe(true);
      expect(lines[3].startsWith("TOTAL,")).toBe(true);
    }
    const revenue = (await report("revenue", { from: "2026-11-03", to: "2026-11-03", format: "csv" })).text.split("\r\n");
    expect(revenue[1]).toBe("2026-11-03,2,100,1,60,40,40,60,40,60");
  });

  test("dates default to today, and bad queries are refused", async () => {
    expect((await report("revenue")).body).toEqual(expect.objectContaining({ from: "2026-11-04", to: "2026-11-04", total: 0 }));
    expect((await report("revenue", { from: "2026-11-02" })).body.days).toHaveLength(3); // until today

    const bad = await report("revenue", { from: "2026-02-30", format: "xml" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(["format", "from"]);
    expect((await report("revenue", { from: "2026-11-03", to: "2026-11-02" })).status).toBe(400);
    expect((await report("revenue", { from: "2025-01-01", to: "2026-11-02" })).status).toBe(400); // over 366 days
    expect((await api.get("/api/reports/revenue").set(as("admin"))).status).toBe(400); // no facility
    expect((await report("profit")).status).toBe(404);
    expect((await report("revenue").set(as("attendant"))).status).toBe(403);
  });
});
