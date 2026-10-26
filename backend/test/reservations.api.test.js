// Online pre-booking with atomic slot locking (VPS-F-020, VPS-F-022, VPS-F-023) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const { signToken } = require("../src/auth");
const clock = require("../src/clock");
const qr = require("../src/qr");
const Reservation = require("../src/models/Reservation");
const Slot = require("../src/models/Slot");
const notifications = require("../src/notifications");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const at = (time, day = "2026-11-02") => `${day}T${time}:00+05:30`;

const city = {
  key: "city", name: "City Centre", openTime: "06:00", closeTime: "23:00", reservationGraceMinutes: 15,
  zones: [
    { key: "zoneA", name: "Zone A", slots: [
      { key: "a2", number: "A-02", vehicleType: "CAR", distance: 20 },
      { key: "a1", number: "A-01", vehicleType: "CAR", distance: 10 },
      { key: "bike", number: "A-B1", vehicleType: "BIKE", distance: 2 },
    ] },
    { key: "zoneB", name: "Zone B", slots: [{ key: "b1", number: "B-01", vehicleType: "CAR", distance: 15 }] },
  ],
};
const tiny = { key: "tiny", name: "Tiny Lot", openTime: "00:00", closeTime: "23:59",
  zones: [{ key: "zoneT", name: "Zone T", slots: [{ key: "only", number: "T-01", vehicleType: "CAR", distance: 1 }] }] };

describeDb("online pre-booking", () => {
  // one listening server, so parallel requests don't each start their own
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};

  async function makeDriver(key, plateNumber, vehicleType = "CAR") {
    const { user, vehicles } = await createAccount({ name: `Driver ${key}`, email: `${key}@example.com`, password: "Secret123",
      vehicles: [{ plateNumber, vehicleType }] });
    tokens[key] = signToken(user);
    ids[key] = user.id;
    ids[`${key}Car`] = vehicles[0].id;
  }
  const as = (key) => ({ authorization: `Bearer ${tokens[key]}` });
  const book = (key, body = {}) => api.post("/api/reservations").set(as(key))
    .send({ vehicleId: ids[`${key}Car`], facilityId: ids.city, startTime: at("14:00"), endTime: at("16:00"), ...body });

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_reservations";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    notifications.clear();
    ids = { ...(await createFacility(city)).ids, ...(await createFacility(tiny)).ids };
    await makeDriver("ann", "KA01AA0001");
    await makeDriver("bob", "KA01BB0002");
    await makeDriver("cat", "KA01CC0003", "BIKE");
    const { user: admin } = await createAccount({ name: "Admin", email: "admin@example.com", password: "Secret123", role: "ADMIN" });
    tokens.admin = signToken(admin);
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    server.closeAllConnections();
    server.close();
  });

  describe("booking", () => {
    test("books the nearest free slot for the vehicle's type and holds it until the grace period ends", async () => {
      const res = await book("ann");
      expect(res.status).toBe(201);
      expect(res.body).toEqual(expect.objectContaining({
        status: "HELD", slotId: ids.a1, slotNumber: "A-01", zoneName: "Zone A", facilityName: "City Centre",
        plateNumber: "KA01AA0001", startTime: new Date(at("14:00")).toISOString(),
        holdExpiresAt: new Date(at("14:15")).toISOString(),
      }));
      expect(qr.readBookingCode(res.body.qrCode)).toBe(res.body.reservationId);
      expect(notifications.sent()).toEqual([expect.objectContaining({ to: "ann@example.com", type: "RESERVATION_HELD" })]);
    });

    test("the next driver gets the next nearest slot; a zone or a slot from the search results can be chosen", async () => {
      expect((await book("ann")).body.slotNumber).toBe("A-01");
      expect((await book("bob")).body.slotNumber).toBe("B-01");
      await Reservation.deleteMany({});
      expect((await book("ann", { zoneId: ids.zoneB })).body.slotNumber).toBe("B-01");
      expect((await book("bob", { slotId: ids.a2 })).body.slotNumber).toBe("A-02");
    });

    test("vehicle type decides the slot", async () => {
      expect((await book("cat")).body.slotNumber).toBe("A-B1");
      const wrongType = await book("cat", { slotId: ids.a1, startTime: at("17:00"), endTime: at("18:00") });
      expect(wrongType.status).toBe(400);
      expect(wrongType.body.error.details).toEqual({ slotId: "This slot doesn't fit your vehicle" });
    });

    test("a booked slot is no longer offered by search for overlapping windows", async () => {
      await book("ann", { zoneId: ids.zoneA });
      const search = await api.get("/api/slots/available").set(as("bob"))
        .query({ facilityId: ids.city, zoneId: ids.zoneA, vehicleType: "CAR", startTime: at("15:00"), endTime: at("17:00") });
      expect(search.body.slots.map((s) => s.number)).toEqual(["A-02"]);
    });

    test("409 when no slot is free, or the chosen slot was just taken", async () => {
      expect((await book("ann", { facilityId: ids.tiny })).status).toBe(201);
      const full = await book("bob", { facilityId: ids.tiny, startTime: at("15:00"), endTime: at("17:00") });
      expect(full.status).toBe(409);
      expect(full.body.error.message).toMatch(/no slot is free/i);
      const taken = await book("bob", { facilityId: ids.tiny, slotId: ids.only });
      expect(taken.status).toBe(409);
      expect(taken.body.error.message).toMatch(/just been booked/i);
      // a window that only touches the booking is fine
      expect((await book("bob", { facilityId: ids.tiny, startTime: at("16:00"), endTime: at("17:00") })).status).toBe(201);
    });

    test("one vehicle can't hold two overlapping bookings", async () => {
      await book("ann");
      const again = await book("ann", { startTime: at("15:00"), endTime: at("18:00") });
      expect(again.status).toBe(409);
      expect(again.body.error.message).toMatch(/KA01AA0001 already has a booking/);
    });

    test("the same window rules as search apply (422), and fields are validated (400)", async () => {
      expect((await book("ann", { startTime: at("22:00"), endTime: at("23:30") })).status).toBe(422);
      expect((await book("ann", { startTime: at("08:00"), endTime: at("09:00") })).status).toBe(422);
      const bad = await book("ann", { vehicleId: "x", facilityId: "y", startTime: "soon" });
      expect(bad.status).toBe(400);
      expect(Object.keys(bad.body.error.details).sort()).toEqual(["facilityId", "startTime", "vehicleId"]);
    });

    test("a driver can only book with their own vehicle", async () => {
      const res = await book("ann", { vehicleId: ids.bobCar });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ vehicleId: "Choose one of your vehicles" });
    });
  });

  describe("atomic slot locking", () => {
    test("of 20 simultaneous bookings for the last slot, exactly one succeeds", async () => {
      const keys = Array.from({ length: 20 }, (_, i) => `rush${i}`);
      for (const [i, key] of keys.entries()) await makeDriver(key, `KA09RU${String(i).padStart(4, "0")}`);
      const results = await Promise.all(keys.map((key) => book(key, { facilityId: ids.tiny })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(19);
      expect(await Reservation.countDocuments({ slot: ids.only })).toBe(1);
    });

    test("a booking that loses the race for a slot moves on to the next one", async () => {
      const results = await Promise.all([book("ann", { zoneId: ids.zoneA }), book("bob", { zoneId: ids.zoneA })]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results.map((r) => r.body.slotNumber).sort()).toEqual(["A-01", "A-02"]);
    });

    test("every booking bumps the slot's version", async () => {
      await book("ann", { facilityId: ids.tiny });
      expect((await Slot.findById(ids.only)).version).toBe(1);
    });
  });

  describe("holds", () => {
    test("a hold lapses after the grace period: the booking is EXPIRED and the slot is free again", async () => {
      const res = await book("ann", { facilityId: ids.tiny, startTime: at("10:30"), endTime: at("12:00") });
      clock.set(new Date(at("10:44")));
      expect((await api.get(`/api/reservations/${res.body.reservationId}`).set(as("ann"))).body.status).toBe("HELD");
      clock.set(new Date(at("10:46")));
      const after = await api.get(`/api/reservations/${res.body.reservationId}`).set(as("ann"));
      expect(after.body.status).toBe("EXPIRED");
      expect(after.body.qrCode).toBeNull();
      expect((await book("bob", { facilityId: ids.tiny, startTime: at("11:00"), endTime: at("12:00") })).status).toBe(201);
    });
  });

  describe("viewing and cancelling", () => {
    test("drivers list and see only their own bookings", async () => {
      const mine = await book("ann");
      await book("bob");
      const list = await api.get("/api/reservations").set(as("ann"));
      expect(list.body.reservations.map((r) => r.reservationId)).toEqual([mine.body.reservationId]);
      expect((await api.get(`/api/reservations/${mine.body.reservationId}`).set(as("bob"))).status).toBe(404);
      expect((await api.get("/api/reservations/not-an-id").set(as("ann"))).status).toBe(404);
      expect((await api.get(`/api/reservations/${mine.body.reservationId}`).set(as("admin"))).status).toBe(200);
    });

    test("cancelling frees the slot; a cancelled booking can't be cancelled again", async () => {
      const res = await book("ann", { facilityId: ids.tiny });
      const cancel = await api.post(`/api/reservations/${res.body.reservationId}/cancel`).set(as("ann"));
      expect(cancel.status).toBe(200);
      expect(cancel.body.status).toBe("CANCELLED");
      expect((await book("bob", { facilityId: ids.tiny })).status).toBe(201);
      const again = await api.post(`/api/reservations/${res.body.reservationId}/cancel`).set(as("ann"));
      expect(again.status).toBe(409);
    });

    test("another driver can't cancel it; an admin can, and that is audited", async () => {
      const res = await book("ann");
      expect((await api.post(`/api/reservations/${res.body.reservationId}/cancel`).set(as("bob"))).status).toBe(404);
      expect((await api.post(`/api/reservations/${res.body.reservationId}/cancel`).set(as("admin"))).status).toBe(200);
      const logs = await api.get("/api/admin/audit-logs?event=RESERVATION_CANCELLED").set(as("admin"));
      expect(logs.body.logs).toHaveLength(1);
    });
  });
});

describe("booking QR codes", () => {
  test("a code is read back only if it is unaltered and of the right kind", () => {
    const code = qr.bookingCode("abc123");
    expect(qr.readBookingCode(code)).toBe("abc123");
    expect(qr.readTicketCode(code)).toBeNull();
    expect(qr.readBookingCode(code.replace("abc123", "abc124"))).toBeNull();
    expect(qr.readBookingCode("not-a-code")).toBeNull();
    expect(qr.readBookingCode(undefined)).toBeNull();
  });
});
