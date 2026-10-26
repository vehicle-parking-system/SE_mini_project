// Vehicle entry capture (VPS-F-001) against a real MongoDB.
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
const Slot = require("../src/models/Slot");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const NOW = "2026-11-02T10:00:00+05:30";
const at = (time, day = "2026-11-02") => `${day}T${time}:00+05:30`;

const city = {
  key: "city", name: "City Centre", openTime: "06:00", closeTime: "23:00", reservationGraceMinutes: 15,
  gates: [{ key: "in", type: "ENTRY" }, { key: "out", type: "EXIT" }],
  zones: [{ key: "zoneA", name: "Zone A", slots: [
    { key: "a1", number: "A-01", vehicleType: "CAR", distance: 10 },
    { key: "a2", number: "A-02", vehicleType: "CAR", distance: 20 },
    { key: "bike", number: "A-B1", vehicleType: "BIKE", distance: 5 },
  ] }],
};
const other = { key: "other", name: "Other Lot", openTime: "00:00", closeTime: "23:59",
  gates: [{ key: "otherIn", type: "ENTRY" }],
  zones: [{ key: "zoneX", name: "Zone X", slots: [{ key: "x1", number: "X-01", vehicleType: "CAR" }] }] };

describeDb("vehicle entry", () => {
  const server = createApp().listen(0);
  const api = request(server);
  let ids;
  const tokens = {};

  const as = (role) => ({ authorization: `Bearer ${tokens[role]}` });
  const enter = (body) => api.post("/api/entry").set(as("attendant")).send({ gateId: ids.in, source: "ANPR", vehicleType: "CAR", ...body });
  const commands = (command) => hardware.sent().filter((c) => !command || c.command === command);
  const book = (slotKey, start, end, extra = {}) => Reservation.create({ slot: ids[slotKey], facility: ids.city,
    zone: ids.zoneA, driver: ids.driver, vehicle: ids.car, startTime: at(start), endTime: at(end), status: "HELD",
    holdExpiresAt: new Date(Date.parse(at(start)) + 15 * 60000), ...extra });
  const slotStatus = async (key) => (await Slot.findById(ids[key])).status;

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_entry";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    hardware.clear();
    ids = { ...(await createFacility(city)).ids, ...(await createFacility(other)).ids };
    const { user: driver, vehicles } = await createAccount({ name: "Driver", email: "driver@example.com", password: "Secret123",
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

  describe("walk-ins (ANPR and manual)", () => {
    test("opens a session in a free slot of the vehicle type, then directs the driver and raises the barrier", async () => {
      const res = await enter({ plateNumber: "ka05 xy-0001" });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(expect.objectContaining({
        status: "ACTIVE", plateNumber: "KA05XY0001", vehicleType: "CAR", source: "ANPR", gateId: ids.in, gateName: "Entry 1",
        slotNumber: "A-01", zoneName: "Zone A", entryTime: expect.stringMatching(/^2026-11-02T04:30:0/), // 10:00 IST
        reservationId: null, exitTime: null,
      }));
      expect(await slotStatus("a1")).toBe("OCCUPIED");
      expect(commands()).toEqual([
        expect.objectContaining({ gateId: ids.in, command: "DISPLAY", message: "Proceed to slot A-01 · Zone A · 10 m" }),
        expect.objectContaining({ gateId: ids.in, command: "OPEN" }),
      ]);
    });

    test("a registered plate is linked to its vehicle, whose type is used if none is given", async () => {
      const res = await enter({ plateNumber: "KA01AB1234", source: "MANUAL", vehicleType: undefined });
      expect(res.status).toBe(201);
      expect(res.body.vehicleType).toBe("CAR");
      expect(res.body.source).toBe("MANUAL");
      const session = await api.get(`/api/sessions/${res.body.sessionId}`).set(as("attendant"));
      expect(session.body).toEqual(res.body);
    });

    test("an unknown plate needs a vehicle type", async () => {
      const res = await enter({ plateNumber: "KA05XY0001", vehicleType: undefined });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ vehicleType: "Choose the vehicle type" });
      expect(commands("OPEN")).toHaveLength(0);
    });

    test("a vehicle can't enter twice, even with simultaneous requests", async () => {
      expect((await enter({ plateNumber: "KA05XY0001" })).status).toBe(201);
      const again = await enter({ plateNumber: "KA05XY0001" });
      expect(again.status).toBe(409);
      expect(again.body.error.message).toBe("KA05XY0001 is already parked here");

      const race = await Promise.all([enter({ plateNumber: "KA05XY0002" }), enter({ plateNumber: "KA05XY0002" })]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await Slot.countDocuments({ status: "OCCUPIED" })).toBe(2); // the loser's slot was given back
    });

    test("a walk-in isn't given a slot booked for later today", async () => {
      await book("a1", "18:00", "20:00");
      expect((await enter({ plateNumber: "KA05XY0001" })).body.slotNumber).toBe("A-02");
    });

    test("no free slot of the type: 409 Facility Full, the barrier stays closed", async () => {
      await enter({ plateNumber: "KA05XY0001" });
      await enter({ plateNumber: "KA05XY0002" });
      hardware.clear();
      const res = await enter({ plateNumber: "KA05XY0003" });
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({ code: "FACILITY_FULL", message: "Facility Full: no free car slot" });
      expect(commands()).toEqual([expect.objectContaining({ command: "DISPLAY", message: "Facility Full" })]);
      expect((await enter({ plateNumber: "KA05XY0003", vehicleType: "BIKE" })).body.slotNumber).toBe("A-B1");
    });
  });

  describe("booked vehicles", () => {
    test("the booking's QR code checks the vehicle in to its booked slot", async () => {
      const booking = await book("a2", "10:00", "12:00");
      const res = await enter({ source: "QR", qrCode: qr.bookingCode(booking.id), plateNumber: undefined, vehicleType: undefined });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(expect.objectContaining({ slotNumber: "A-02", plateNumber: "KA01AB1234", source: "QR",
        reservationId: booking.id }));
      const checkedIn = await Reservation.findById(booking.id);
      expect(checkedIn.status).toBe("CHECKED_IN");
      expect(checkedIn.session.toString()).toBe(res.body.sessionId);

      const reused = await enter({ source: "QR", qrCode: qr.bookingCode(booking.id) });
      expect(reused.status).toBe(409);
      expect(reused.body.error.message).toBe("This booking is checked in");
    });

    test("ANPR recognises a booked vehicle's plate and uses its booking", async () => {
      const booking = await book("a2", "10:15", "12:00");
      const res = await enter({ plateNumber: "KA01AB1234" });
      expect(res.body).toEqual(expect.objectContaining({ slotNumber: "A-02", reservationId: booking.id }));
    });

    test("a booking can be used from 30 minutes before its start until its hold lapses", async () => {
      const early = await book("a2", "10:31", "12:00");
      const tooEarly = await enter({ source: "QR", qrCode: qr.bookingCode(early.id) });
      expect(tooEarly.status).toBe(409);
      expect(tooEarly.body.error.message).toBe("Too early: this booking starts at 10:31");

      const late = await book("a1", "09:00", "11:00", { vehicle: undefined });
      clock.set(new Date(at("09:16")));
      const expired = await enter({ source: "QR", qrCode: qr.bookingCode(late.id), vehicleType: "CAR", plateNumber: "KA05XY0001" });
      expect(expired.status).toBe(409);
      expect(expired.body.error.message).toBe("This booking is expired");
      expect(commands("OPEN")).toHaveLength(0);
      expect(commands("DISPLAY").map((c) => c.message)).toEqual(["Too early: this booking starts at 10:31", "This booking is expired"]);
    });

    test("a booking for another facility is refused", async () => {
      const booking = await book("a2", "10:00", "12:00");
      const res = await api.post("/api/entry").set(as("attendant"))
        .send({ gateId: ids.otherIn, source: "QR", qrCode: qr.bookingCode(booking.id) });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe("This booking is for another facility");
    });

    test("an invalid or altered QR code is refused with 'Invalid ticket' (400)", async () => {
      const booking = await book("a2", "10:00", "12:00");
      for (const qrCode of ["not-a-valid-ticket", qr.bookingCode(booking.id).slice(0, -1) + "x", qr.ticketCode(booking.id)]) {
        const res = await enter({ source: "QR", qrCode });
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe("Invalid ticket");
      }
      expect(commands("OPEN")).toHaveLength(0);
      expect(commands("DISPLAY").map((c) => c.message)).toEqual(Array(3).fill("Invalid ticket"));
    });
  });

  describe("entry tickets", () => {
    test("every entry returns a signed QR ticket that scans back to the session at the exit", async () => {
      const entry = await enter({ plateNumber: "KA05XY0001" });
      expect(qr.readTicketCode(entry.body.ticketQr)).toBe(entry.body.sessionId);
      const scan = await api.post("/api/tickets/scan").set(as("attendant")).send({ qrCode: entry.body.ticketQr });
      expect(scan.status).toBe(200);
      expect(scan.body).toEqual(expect.objectContaining({ sessionId: entry.body.sessionId, entryTime: entry.body.entryTime,
        slotNumber: entry.body.slotNumber, plateNumber: "KA05XY0001", status: "ACTIVE" }));
    });

    test("invalid, altered or booking codes are not tickets (400)", async () => {
      const entry = await enter({ plateNumber: "KA05XY0001" });
      for (const qrCode of ["nonsense", entry.body.ticketQr.slice(0, -2) + "zz", qr.bookingCode(entry.body.sessionId), undefined]) {
        const res = await api.post("/api/tickets/scan").set(as("attendant")).send({ qrCode });
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe("Invalid ticket");
      }
      expect((await api.post("/api/tickets/scan").set(as("driver")).send({ qrCode: entry.body.ticketQr })).status).toBe(403);
    });

    test("a registered driver gets a digital ticket: by notification and in their parking sessions", async () => {
      const notifications = require("../src/notifications");
      notifications.clear();
      const entry = await enter({ plateNumber: "KA01AB1234" });
      expect(notifications.sent()).toEqual([expect.objectContaining({ to: "driver@example.com", type: "ENTRY_TICKET",
        data: { sessionId: entry.body.sessionId, slotNumber: "A-01", entryTime: entry.body.entryTime } })]);

      const mine = await api.get("/api/users/me/sessions").set(as("driver"));
      expect(mine.body.sessions).toEqual([expect.objectContaining({ sessionId: entry.body.sessionId, ticketQr: entry.body.ticketQr })]);
      // walk-ins with unregistered plates notify nobody
      notifications.clear();
      await enter({ plateNumber: "KA05XY0001" });
      expect(notifications.sent()).toEqual([]);
    });
  });

  describe("requests and access", () => {
    test("fields are validated and only entry gates are accepted", async () => {
      const bad = await api.post("/api/entry").set(as("attendant")).send({ gateId: "g", source: "CAMERA", plateNumber: "!" });
      expect(bad.status).toBe(400);
      expect(Object.keys(bad.body.error.details).sort()).toEqual(["gateId", "plateNumber", "source"]);
      expect((await enter({ gateId: ids.out, plateNumber: "KA05XY0001" })).status).toBe(404);
    });

    test("staff list sessions and see gates; drivers can't capture entries", async () => {
      await enter({ plateNumber: "KA05XY0001" });
      const list = await api.get(`/api/sessions?facilityId=${ids.city}&status=ACTIVE`).set(as("admin"));
      expect(list.body.sessions.map((s) => s.plateNumber)).toEqual(["KA05XY0001"]);
      expect((await api.get(`/api/sessions?facilityId=${ids.other}`).set(as("admin"))).body.sessions).toEqual([]);
      expect((await api.get("/api/sessions/nope").set(as("admin"))).status).toBe(404);

      const facilities = await api.get("/api/facilities").set(as("attendant"));
      expect(facilities.body.facilities[0].gates).toEqual([
        { id: ids.in, name: "Entry 1", type: "ENTRY" }, { id: ids.out, name: "Exit 1", type: "EXIT" }]);
      expect((await api.get("/api/facilities").set(as("driver"))).body.facilities[0].gates).toBeUndefined();
      expect((await api.post("/api/entry").set(as("driver")).send({})).status).toBe(403);
    });
  });
});

test("localInstant handles time zones and daylight-saving changes", () => {
  const { localInstant } = require("../src/time");
  expect(localInstant("2026-11-02", "23:00", "Asia/Kolkata").toISOString()).toBe("2026-11-02T17:30:00.000Z");
  expect(localInstant("2026-03-08", "03:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  expect(localInstant("2026-07-01", "10:00", "Europe/London").toISOString()).toBe("2026-07-01T09:00:00.000Z");
});
