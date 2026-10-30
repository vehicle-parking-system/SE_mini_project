// Facility full check & gate rejection (VPS-F-003) and live occupancy, against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const hardware = require("../src/hardware");
const qr = require("../src/qr");
const Reservation = require("../src/models/Reservation");
const Session = require("../src/models/Session");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const at = (time) => `2026-11-02T${time}:00+05:30`;

const lot = {
  key: "lot", name: "Lot", openTime: "06:00", closeTime: "23:00",
  gates: [{ key: "in", type: "ENTRY" }],
  zones: [
    { key: "zoneA", name: "Zone A", slots: [
      { key: "a1", number: "A-01", vehicleType: "CAR", distance: 10 },
      { key: "a2", number: "A-02", vehicleType: "CAR", distance: 20 },
      { key: "off", number: "A-03", vehicleType: "CAR", distance: 30, status: "INACTIVE" },
    ] },
    { key: "zoneB", name: "Zone B", slots: [{ key: "bike", number: "B-B1", vehicleType: "BIKE", distance: 5 }] },
  ],
};

describeDb("facility full check and occupancy", () => {
  let server, api;
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const enter = (body) => api.post("/api/entry").set(as("attendant"))
    .send({ gateId: ids.in, source: "ANPR", vehicleType: "CAR", ...body });
  const occupancy = async () => (await api.get(`/api/occupancy/${ids.lot}`).set(as("attendant"))).body;
  const book = (slotKey, start, end) => Reservation.create({ slot: ids[slotKey], facility: ids.lot, zone: ids.zoneA,
    driver: ids.driver, vehicle: ids.car, startTime: at(start), endTime: at(end), status: "CONFIRMED",
    holdExpiresAt: new Date(Date.parse(at(start)) + 15 * 60000) });

  beforeAll(async () => {
    server = createApp().listen(0);
    api = request(server);
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_occupancy";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    hardware.clear();
    ids = (await createFacility(lot)).ids;
    const { user: driver, vehicles } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123",
      vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }] });
    Object.assign(ids, { driver: driver.id, car: vehicles[0].id });
    tokens.driver = signToken(driver);
    for (const role of ["ATTENDANT", "ADMIN"]) {
      const { user } = await createAccount({ name: role, email: `${role.toLowerCase()}@example.com`, password: "Secret123", role });
      tokens[role.toLowerCase()] = signToken(user);
    }
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("occupancy counts active slots as occupied, booked for now, or free — in total, per type and per zone", async () => {
    expect(await occupancy()).toEqual(expect.objectContaining({ capacity: 3, occupied: 0, booked: 0, free: 3, full: false }));
    await enter({ plateNumber: "KA05XY0001" });
    await book("a2", "09:30", "11:00");
    const now = await occupancy();
    expect(now).toEqual(expect.objectContaining({ facilityId: ids.lot, name: "Lot", capacity: 3, occupied: 1, booked: 1, free: 1, full: false }));
    expect(now.byVehicleType).toEqual([
      { vehicleType: "CAR", capacity: 2, occupied: 1, booked: 1, free: 0, full: true },
      { vehicleType: "BIKE", capacity: 1, occupied: 0, booked: 0, free: 1, full: false },
    ]);
    expect(now.byZone).toEqual([
      { zoneId: ids.zoneA, name: "Zone A", capacity: 2, occupied: 1, booked: 1, free: 0 },
      { zoneId: ids.zoneB, name: "Zone B", capacity: 1, occupied: 0, booked: 0, free: 1 },
    ]);
  });

  test("when no slot fits, entry is refused with 'Facility Full', the barrier stays closed and nothing changes", async () => {
    await enter({ plateNumber: "KA05XY0001" });
    await enter({ plateNumber: "KA05XY0002" });
    const before = await occupancy();
    hardware.clear();

    const res = await enter({ plateNumber: "KA05XY0003" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("FACILITY_FULL");
    expect(hardware.sent()).toEqual([expect.objectContaining({ gateId: ids.in, command: "DISPLAY", message: "Facility Full" })]);
    expect(await occupancy()).toEqual({ ...before, checkedAt: expect.any(String) });
    expect(await Session.countDocuments({ plateNumber: "KA05XY0003" })).toBe(0);
  });

  test("full for cars doesn't stop a bike", async () => {
    await enter({ plateNumber: "KA05XY0001" });
    await enter({ plateNumber: "KA05XY0002" });
    expect((await enter({ plateNumber: "KA05XY0003" })).status).toBe(409);
    expect((await enter({ plateNumber: "KA05XY0004", vehicleType: "BIKE" })).status).toBe(201);
    expect((await occupancy()).full).toBe(true);
  });

  test("walk-ins are refused when the only free slot is booked, but the booked driver still gets in", async () => {
    await enter({ plateNumber: "KA05XY0001" });
    const booking = await book("a2", "10:00", "12:00");
    expect((await enter({ plateNumber: "KA05XY0002" })).body.error.code).toBe("FACILITY_FULL");
    const booked = await enter({ source: "QR", qrCode: qr.bookingCode(booking.id) });
    expect(booked.status).toBe(201);
    expect(booked.body.slotNumber).toBe("A-02");
  });

  test("occupancy is for staff; unknown facilities are 404", async () => {
    expect((await api.get(`/api/occupancy/${ids.lot}`).set(as("admin"))).status).toBe(200);
    expect((await api.get(`/api/occupancy/${ids.lot}`).set(as("driver"))).status).toBe(403);
    expect((await api.get("/api/occupancy/nope").set(as("admin"))).status).toBe(404);
  });
});
