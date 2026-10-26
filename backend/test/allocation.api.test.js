// Automated nearest-slot allocation (VPS-F-002) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const Reservation = require("../src/models/Reservation");
const Session = require("../src/models/Session");
const Slot = require("../src/models/Slot");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const at = (time) => `2026-11-02T${time}:00+05:30`;

const lot = {
  key: "lot", name: "Lot", openTime: "06:00", closeTime: "23:00",
  gates: [{ key: "in", type: "ENTRY" }],
  zones: [
    { key: "zoneA", name: "Zone A", slots: [
      { key: "a1", number: "A-01", vehicleType: "CAR", distance: 30 },
      { key: "a2", number: "A-02", vehicleType: "CAR", distance: 10 },
      { key: "a3", number: "A-03", vehicleType: "CAR", distance: 5, status: "INACTIVE" },
      { key: "bike", number: "A-B1", vehicleType: "BIKE", distance: 1 },
    ] },
    { key: "zoneB", name: "Zone B", slots: [{ key: "b1", number: "B-01", vehicleType: "CAR", distance: 20 }] },
  ],
};
const single = { key: "single", name: "Single", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "singleIn", type: "ENTRY" }],
  zones: [{ key: "zoneS", name: "Zone S", slots: [{ key: "only", number: "S-01", vehicleType: "CAR", distance: 1 }] }] };

describeDb("nearest-slot allocation", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const enter = (plateNumber, gate = "in") => api.post("/api/entry").set(as("attendant"))
    .send({ gateId: ids[gate], source: "ANPR", plateNumber, vehicleType: "CAR" });
  const plate = (i) => `KA09ZZ${String(i).padStart(4, "0")}`;

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_allocation";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    ids = { ...(await createFacility(lot)).ids, ...(await createFacility(single)).ids };
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    tokens.attendant = signToken(attendant);
    const { user: driver, vehicles } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123",
      vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }] });
    tokens.driver = signToken(driver);
    ids.car = vehicles[0].id;
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("the nearest free slot of the vehicle type is given first, across zones; inactive slots never", async () => {
    const order = [];
    for (let i = 0; i < 4; i++) {
      const res = await enter(plate(i));
      order.push(res.status === 201 ? res.body.slotNumber : res.status);
    }
    expect(order).toEqual(["A-02", "B-01", "A-01", 409]);
  });

  test("the gate display tells the driver where to go", async () => {
    await enter(plate(1));
    const hardware = require("../src/hardware");
    expect(hardware.sent().at(-2)).toEqual(expect.objectContaining({ command: "DISPLAY", message: "Proceed to slot A-02 · Zone A · 10 m" }));
  });

  test("the allocated slot is OCCUPIED, and staff can read any slot's live status", async () => {
    const res = await enter(plate(1));
    const slot = await api.get(`/api/slots/${res.body.slotId}`).set(as("attendant"));
    expect(slot.status).toBe(200);
    expect(slot.body).toEqual({ slotId: ids.a2, number: "A-02", vehicleType: "CAR", distance: 10, status: "OCCUPIED",
      facilityId: ids.lot, zoneId: ids.zoneA, zoneName: "Zone A" });
    expect((await api.get(`/api/slots/${ids.a3}`).set(as("attendant"))).body.status).toBe("INACTIVE");
    expect((await api.get("/api/slots/nope").set(as("attendant"))).status).toBe(404);
    expect((await api.get(`/api/slots/${ids.a2}`).set(as("driver"))).status).toBe(403);
  });

  test("simultaneous entries each get a different slot; the rest are refused", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => enter(plate(i))));
    const allocated = results.filter((r) => r.status === 201).map((r) => r.body.slotNumber);
    expect(allocated.sort()).toEqual(["A-01", "A-02", "B-01"]);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await Session.countDocuments()).toBe(3);
  });

  test("a vehicle entering and a driver booking the same last slot at once: only one of them gets it", async () => {
    for (let round = 0; round < 8; round++) {
      await Promise.all([Reservation.deleteMany({}), Session.deleteMany({}),
        Slot.updateOne({ _id: ids.only }, { status: "AVAILABLE" })]);
      const [entry, booking] = await Promise.all([
        enter(plate(round), "singleIn"),
        api.post("/api/reservations").set(as("driver"))
          .send({ vehicleId: ids.car, facilityId: ids.single, startTime: at("10:30"), endTime: at("12:00") }),
      ]);
      expect([entry.status, booking.status].sort()).toEqual([201, 409]);
    }
  });
});
