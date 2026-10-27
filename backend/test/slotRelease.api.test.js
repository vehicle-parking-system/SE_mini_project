// Real-time slot release on exit (VPS-F-012) and live slot events, against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const http = require("http");
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const payments = require("../src/payments");
const Reservation = require("../src/models/Reservation");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const at = (time) => `2026-11-02T${time}:00+05:30`;

const lot = {
  key: "lot", name: "Lot", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [
    { key: "a1", number: "A-01", vehicleType: "CAR", distance: 1 },
    { key: "a2", number: "A-02", vehicleType: "CAR", distance: 2 },
  ] }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
};
const other = { key: "other", name: "Other", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "otherIn", type: "ENTRY" }],
  zones: [{ key: "zoneX", name: "Zone X", slots: [{ key: "x1", number: "X-01", vehicleType: "CAR" }] }] };

describeDb("slot release on exit", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const enter = (body) => api.post("/api/entry").set(as("attendant")).send({ gateId: ids.in, source: "ANPR", vehicleType: "CAR", ...body });
  const slotStatus = async (key) => (await api.get(`/api/slots/${ids[key]}`).set(as("attendant"))).body.status;
  // pays the session in full (as if the gateway confirmed it) and exits
  async function payAndExit(sessionId) {
    const payment = await api.post("/api/payments").set(as("attendant")).send({ sessionId, method: "AT_GATE", gatewayToken: "tok_x" });
    await payments.handleGatewayEvent({ paymentId: payment.body.paymentId, status: "CONFIRMED" });
    return api.post("/api/exit").set(as("attendant")).send({ gateId: ids.out, sessionId });
  }

  // Opens GET /api/events and collects the events it receives.
  function listen(query = "") {
    const received = [];
    const { port } = server.address();
    const req = http.get({ port, path: `/api/events${query}`, headers: as("attendant") }, (res) => {
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop();
        for (const block of blocks) {
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (data) received.push(JSON.parse(data.slice(6)));
        }
      });
    });
    return { received, connected: new Promise((r) => req.on("response", r)), close: () => req.destroy() };
  }
  const settle = () => new Promise((r) => setTimeout(r, 100));

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_release";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    ids = { ...(await createFacility(lot)).ids, ...(await createFacility(other)).ids };
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    const { user: driver, vehicles } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123",
      vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }] });
    Object.assign(tokens, { attendant: signToken(attendant), driver: signToken(driver) });
    Object.assign(ids, { driver: driver.id, car: vehicles[0].id });
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("the slot is AVAILABLE as soon as the exit is confirmed, and the next vehicle can have it", async () => {
    const { sessionId } = (await enter({ plateNumber: "KA05XY0001" })).body;
    expect(await slotStatus("a1")).toBe("OCCUPIED");
    const exit = await payAndExit(sessionId);
    expect(exit.status).toBe(200);
    expect(exit.body.slotReleased).toBe(true);
    expect(await slotStatus("a1")).toBe("AVAILABLE"); // no waiting: released before the response
    const occupancy = await api.get(`/api/occupancy/${ids.lot}`).set(as("attendant"));
    expect(occupancy.body).toEqual(expect.objectContaining({ occupied: 0, free: 2 }));
    expect((await enter({ plateNumber: "KA05XY0002" })).body.slotNumber).toBe("A-01");
  });

  test("a vehicle that leaves before its booking ends completes the booking, so the slot is free for others", async () => {
    const booking = await api.post("/api/reservations").set(as("driver"))
      .send({ vehicleId: ids.car, facilityId: ids.lot, slotId: ids.a2, startTime: at("10:00"), endTime: at("14:00") });
    const { sessionId } = (await enter({ plateNumber: "KA01AB1234" })).body;
    clock.set(new Date(at("11:00")));
    await payAndExit(sessionId);
    expect((await Reservation.findById(booking.body.reservationId)).status).toBe("COMPLETED");
    expect(await slotStatus("a2")).toBe("AVAILABLE");
    // walk-ins skip slots booked later today; A-02's booking no longer counts
    await enter({ plateNumber: "KA05XY0001" });
    expect((await enter({ plateNumber: "KA05XY0002" })).body.slotNumber).toBe("A-02");
  });

  test("gate screens are told at once: a slot event for the entry and for the release", async () => {
    const stream = listen(`?facilityId=${ids.lot}`);
    await stream.connected;
    const { sessionId } = (await enter({ plateNumber: "KA05XY0001" })).body;
    await payAndExit(sessionId);
    await api.post("/api/entry").set(as("attendant")).send({ gateId: ids.otherIn, source: "ANPR", plateNumber: "KA05XY0009", vehicleType: "CAR" });
    await settle();
    stream.close();
    expect(stream.received.map((e) => [e.type, e.number, e.status, e.reason])).toEqual([
      ["slot", "A-01", "OCCUPIED", "ENTRY"],
      ["slot", "A-01", "AVAILABLE", "EXIT"],
    ]); // the other facility's entry isn't in this stream
  });

  test("bookings and cancellations tell searches that availability changed", async () => {
    const stream = listen();
    await stream.connected;
    const booking = await api.post("/api/reservations").set(as("driver"))
      .send({ vehicleId: ids.car, facilityId: ids.lot, startTime: at("12:00"), endTime: at("13:00") });
    await api.post(`/api/reservations/${booking.body.reservationId}/cancel`).set(as("driver"));
    await settle();
    stream.close();
    expect(stream.received.map((e) => [e.type, e.facilityId, e.reason])).toEqual([
      ["availability", ids.lot, "BOOKED"], ["availability", ids.lot, "CANCELLED"]]);
  });

  test("the event stream needs a login", async () => {
    expect((await api.get("/api/events")).status).toBe(401);
  });
});
