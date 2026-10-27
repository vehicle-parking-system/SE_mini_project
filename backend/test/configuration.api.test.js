// Lot, zone, slot and pricing configuration (VPS-F-040, VPS-F-041) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const AuditLog = require("../src/models/AuditLog");
const Reservation = require("../src/models/Reservation");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const at = (time) => `2026-11-02T${time}:00+05:30`;

const lot = {
  key: "lot", name: "Lot", openTime: "06:00", closeTime: "23:00",
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [
    { key: "a1", number: "A-01", vehicleType: "CAR", distance: 10 },
    { key: "a2", number: "A-02", vehicleType: "CAR", distance: 20 },
  ] }],
  rates: [{ vehicleType: "CAR", ratePerHour: 40 }],
};

const newFacility = {
  name: "North Lot", address: "1 North Road", openTime: "06:00", closeTime: "22:00", reservationGraceMinutes: 10,
  gates: [{ name: "North In", type: "ENTRY" }, { name: "North Out", type: "EXIT" }],
  zones: [{ name: "N1", slots: [{ number: "n-01", vehicleType: "CAR", distance: 5 }, { number: "N-02", vehicleType: "BIKE", distance: 9 }] }],
};

describeDb("lot, zone, slot and pricing configuration", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};

  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const enter = (plateNumber) => api.post("/api/entry").set(as("attendant"))
    .send({ gateId: ids.in, source: "ANPR", plateNumber, vehicleType: "CAR" });

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_configuration";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(at("10:00")));
    ids = (await createFacility(lot)).ids;
    const { user: admin } = await createAccount({ name: "Adm", email: "adm@example.com", password: "Secret123", role: "ADMIN" });
    const { user: attendant } = await createAccount({ name: "Att", email: "att@example.com", password: "Secret123", role: "ATTENDANT" });
    const { user: driver } = await createAccount({ name: "Drv", email: "drv@example.com", password: "Secret123" });
    Object.assign(tokens, { admin: signToken(admin), attendant: signToken(attendant), driver: signToken(driver) });
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  test("an admin creates a facility with gates, zones and slots, and drivers can find it", async () => {
    const res = await api.post("/api/admin/facilities").set(as("admin")).send(newFacility);
    expect(res.status).toBe(201);
    const { facility } = res.body;
    expect(facility).toEqual(expect.objectContaining({ name: "North Lot", openTime: "06:00", closeTime: "22:00",
      timezone: "Asia/Kolkata", reservationGraceMinutes: 10, refundCutoffMinutes: 60 }));
    expect(facility.gates.map((g) => [g.name, g.type])).toEqual([["North In", "ENTRY"], ["North Out", "EXIT"]]);
    expect(facility.zones[0].slots.map((s) => [s.number, s.vehicleType, s.active])).toEqual([["N-01", "CAR", true], ["N-02", "BIKE", true]]);

    const listed = await api.get("/api/facilities").set(as("driver"));
    expect(listed.body.facilities.map((f) => f.name)).toContain("North Lot");
    const logs = await AuditLog.find({ event: "CONFIG_CHANGED" });
    expect(logs.map((l) => l.details.action)).toEqual(["FACILITY_CREATED"]);
  });

  test("invalid facility definitions are refused with every bad field", async () => {
    const res = await api.post("/api/admin/facilities").set(as("admin")).send({
      name: "", openTime: "25:00", closeTime: "07:00", timezone: "Mars/Olympus",
      zones: [{ name: "Z", slots: [{ number: "Z-01", vehicleType: "PLANE" }, { number: "z-01", vehicleType: "CAR" }] }],
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(
      ["name", "openTime", "timezone", "zones[0].slots[0].vehicleType", "zones[0].slots"]));

    const backwards = await api.post("/api/admin/facilities").set(as("admin"))
      .send({ name: "Night", openTime: "22:00", closeTime: "06:00" });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details.closeTime).toMatch(/after opening/);
  });

  test("only admins can change the configuration", async () => {
    for (const role of ["driver", "attendant"]) {
      expect((await api.post("/api/admin/facilities").set(as(role)).send(newFacility)).status).toBe(403);
      expect((await api.put("/api/admin/rates").set(as(role))
        .send({ facilityId: ids.lot, vehicleType: "CAR", ratePerHour: 1 })).status).toBe(403);
      expect((await api.patch(`/api/admin/slots/${ids.a1}`).set(as(role)).send({ active: false })).status).toBe(403);
    }
  });

  test("a deactivated slot is never allocated, and is used again once reactivated", async () => {
    const off = await api.patch(`/api/admin/slots/${ids.a1}`).set(as("admin")).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.slot).toEqual(expect.objectContaining({ status: "INACTIVE", active: false }));

    expect((await enter("KA01AA0001")).body.slotNumber).toBe("A-02");
    expect((await enter("KA01AA0002")).body.error.code).toBe("FACILITY_FULL");

    expect((await api.patch(`/api/admin/slots/${ids.a1}`).set(as("admin")).send({ active: true })).body.slot.status).toBe("AVAILABLE");
    expect((await enter("KA01AA0002")).body.slotNumber).toBe("A-01");
  });

  test("a slot someone is parked in or has booked can't be deactivated or retyped", async () => {
    expect((await enter("KA01AA0001")).body.slotNumber).toBe("A-01");
    const parked = await api.patch(`/api/admin/slots/${ids.a1}`).set(as("admin")).send({ active: false });
    expect(parked.status).toBe(409);
    expect(parked.body.error.message).toMatch(/parked/);

    await Reservation.create({ slot: ids.a2, facility: ids.lot, startTime: at("14:00"), endTime: at("15:00"), status: "CONFIRMED" });
    const booked = await api.patch(`/api/admin/slots/${ids.a2}`).set(as("admin")).send({ vehicleType: "BIKE" });
    expect(booked.status).toBe(409);
    expect(booked.body.error.message).toMatch(/1 active booking/);

    // the distance can still change, and is used for allocation from then on
    expect((await api.patch(`/api/admin/slots/${ids.a2}`).set(as("admin")).send({ distance: 3 })).body.slot.distance).toBe(3);
  });

  test("zones and slots can be added; slot numbers stay unique in the facility", async () => {
    const zone = await api.post(`/api/admin/facilities/${ids.lot}/zones`).set(as("admin"))
      .send({ name: "Zone B", slots: [{ number: "B-01", vehicleType: "TRUCK", distance: 40 }] });
    expect(zone.status).toBe(201);
    expect(zone.body.zone.slots[0]).toEqual(expect.objectContaining({ number: "B-01", vehicleType: "TRUCK" }));

    const more = await api.post(`/api/admin/zones/${zone.body.zone.id}/slots`).set(as("admin"))
      .send({ slots: [{ number: "B-02", vehicleType: "TRUCK" }] });
    expect(more.status).toBe(201);
    expect((await api.post(`/api/admin/zones/${zone.body.zone.id}/slots`).set(as("admin"))
      .send({ slots: [{ number: "a-01", vehicleType: "CAR" }] })).status).toBe(409);
    expect((await api.post(`/api/admin/facilities/${ids.lot}/zones`).set(as("admin")).send({ name: "Zone B" })).status).toBe(409);

    const facility = (await api.get(`/api/admin/facilities/${ids.lot}`).set(as("admin"))).body.facility;
    expect(facility.zones.map((z) => [z.name, z.slots.length])).toEqual([["Zone A", 2], ["Zone B", 2]]);
  });

  test("a changed rate applies to vehicles that enter afterwards, and a zone's rate wins over the facility's", async () => {
    const before = await enter("KA01AA0001");
    const set = await api.put("/api/admin/rates").set(as("admin"))
      .send({ facilityId: ids.lot, zoneId: ids.zoneA, vehicleType: "CAR", ratePerHour: 60 });
    expect(set.status).toBe(200);
    expect(set.body).toEqual(expect.objectContaining({ created: true, rate: expect.objectContaining({ zoneId: ids.zoneA, ratePerHour: 60 }) }));
    const after = await enter("KA01AA0002");

    clock.set(new Date(at("11:30")));
    const fee = async (sessionId) => (await api.get(`/api/sessions/${sessionId}`).set(as("attendant"))).body.fee.total;
    expect(await fee(before.body.sessionId)).toBe(80); //  2 started hours at the old ₹40
    expect(await fee(after.body.sessionId)).toBe(120); //  2 started hours at the zone's ₹60

    const updated = await api.put("/api/admin/rates").set(as("admin"))
      .send({ facilityId: ids.lot, zoneId: ids.zoneA, vehicleType: "CAR", ratePerHour: 55.5 });
    expect(updated.body.created).toBe(false);
    const rates = (await api.get(`/api/admin/rates?facilityId=${ids.lot}`).set(as("admin"))).body.rates;
    expect(rates.map((r) => [r.zoneId, r.ratePerHour]).sort()).toEqual([[ids.zoneA, 55.5], [null, 40]].sort());

    expect((await api.put("/api/admin/rates").set(as("admin"))
      .send({ facilityId: ids.lot, vehicleType: "CAR", ratePerHour: -5 })).status).toBe(400);
    const log = await AuditLog.findOne({ "details.action": "RATE_SET", "details.to": 55.5 });
    expect(log.details.from).toBe(60);
  });

  test("facility hours and settings can be edited, and must stay valid", async () => {
    const res = await api.patch(`/api/admin/facilities/${ids.lot}`).set(as("admin")).send({ closeTime: "21:00", refundCutoffMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.facility).toEqual(expect.objectContaining({ openTime: "06:00", closeTime: "21:00", refundCutoffMinutes: 30 }));
    expect((await api.patch(`/api/admin/facilities/${ids.lot}`).set(as("admin")).send({ closeTime: "05:00" })).status).toBe(400);
    expect((await api.patch(`/api/admin/facilities/${ids.lot}`).set(as("admin")).send({})).status).toBe(400);
  });
});
