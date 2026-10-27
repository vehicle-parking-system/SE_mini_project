// Real-time slot search (VPS-F-021) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const { createFacility } = require("../src/facilities");
const clock = require("../src/clock");
const Reservation = require("../src/models/Reservation");
const { localParts } = require("../src/time");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const PASSWORD = "Secret123";
const NOW = "2026-11-02T10:00:00+05:30";
const at = (time, day = "2026-11-02") => `${day}T${time}:00+05:30`;

const city = {
  key: "city", name: "City Centre", openTime: "06:00", closeTime: "23:00",
  zones: [
    { key: "zoneA", name: "Zone A", slots: [
      { key: "a3", number: "A-03", vehicleType: "CAR", distance: 30 },
      { key: "a1", number: "A-01", vehicleType: "CAR", distance: 10 },
      { key: "a2", number: "A-02", vehicleType: "CAR", distance: 20 },
      { key: "occupied", number: "A-04", vehicleType: "CAR", distance: 5, status: "OCCUPIED" },
      { key: "inactive", number: "A-05", vehicleType: "CAR", distance: 6, status: "INACTIVE" },
      { key: "bike", number: "A-B1", vehicleType: "BIKE", distance: 2 },
    ] },
    { key: "zoneB", name: "Zone B", slots: [{ key: "b1", number: "B-01", vehicleType: "CAR", distance: 15 }] },
  ],
};
const other = { key: "other", name: "Other Lot", openTime: "00:00", closeTime: "23:59",
  zones: [{ key: "zoneX", name: "Zone X", slots: [{ key: "x1", number: "X-01", vehicleType: "CAR" }] }] };

describeDb("real-time slot search", () => {
  const api = request(createApp());
  let ids;
  const tokens = {};

  const search = (params, role = "DRIVER") => api.get("/api/slots/available")
    .query({ facilityId: ids.city, vehicleType: "CAR", startTime: at("14:00"), endTime: at("16:00"), ...params })
    .set("authorization", `Bearer ${tokens[role]}`);
  const listed = async (params) => {
    const res = await search(params);
    expect(res.status).toBe(200);
    return res.body.slots.map((s) => s.number);
  };
  const reserve = (slotKey, start, end, extra = {}) => Reservation.create({
    slot: ids[slotKey], facility: ids.city, startTime: at(start), endTime: at(end), status: "CONFIRMED", ...extra,
  });

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_slots";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.set(new Date(NOW));
    ids = { ...(await createFacility(city)).ids, ...(await createFacility(other)).ids };
    for (const role of ["DRIVER", "ATTENDANT", "ADMIN"]) {
      const email = `${role.toLowerCase()}@example.com`;
      await createAccount({ name: role, email, password: PASSWORD, role });
      tokens[role] = (await api.post("/api/auth/login").send({ email, password: PASSWORD })).body.token;
    }
  });
  afterAll(async () => {
    clock.reset();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  describe("which slots are listed", () => {
    test("free slots of the vehicle type, nearest first; not occupied, inactive or other types", async () => {
      expect(await listed({ zoneId: ids.zoneA })).toEqual(["A-01", "A-02", "A-03"]);
    });

    test("without a zone, every zone of the facility is searched", async () => {
      expect(await listed({})).toEqual(["A-01", "B-01", "A-02", "A-03"]);
    });

    test("other vehicle types get their own slots", async () => {
      expect(await listed({ vehicleType: "BIKE" })).toEqual(["A-B1"]);
      expect(await listed({ vehicleType: "TRUCK" })).toEqual([]);
    });

    test("results describe each slot and the search", async () => {
      const res = await search({ zoneId: ids.zoneA });
      expect(res.body.slots[0]).toEqual({ slotId: ids.a1, number: "A-01", vehicleType: "CAR", distance: 10,
        zoneId: ids.zoneA, zoneName: "Zone A" });
      expect(res.body.facility).toEqual(expect.objectContaining({ id: ids.city, name: "City Centre", openTime: "06:00" }));
      expect(res.body.window).toEqual({ startTime: new Date(at("14:00")).toISOString(), endTime: new Date(at("16:00")).toISOString() });
      // the test clock keeps ticking after it is set (slowly, when every suite runs at once)
      expect(Date.parse(res.body.checkedAt) - Date.parse(NOW)).toBeGreaterThanOrEqual(0);
      expect(Date.parse(res.body.checkedAt) - Date.parse(NOW)).toBeLessThan(10000);
    });
  });

  describe("reservations", () => {
    test.each([
      ["the same window", "14:00", "16:00"],
      ["only the start of the window", "13:00", "14:30"],
      ["only the end of the window", "15:30", "18:00"],
      ["a window inside it", "14:30", "15:00"],
      ["a window around it", "12:00", "18:00"],
    ])("a confirmed reservation overlapping %s hides the slot", async (_what, start, end) => {
      await reserve("a1", start, end);
      expect(await listed({ zoneId: ids.zoneA })).toEqual(["A-02", "A-03"]);
    });

    test("back-to-back reservations don't overlap", async () => {
      await reserve("a1", "12:00", "14:00");
      await reserve("a2", "16:00", "18:00");
      expect(await listed({ zoneId: ids.zoneA })).toEqual(["A-01", "A-02", "A-03"]);
    });

    test("a held reservation blocks the slot until its hold expires", async () => {
      await reserve("a1", "14:00", "16:00", { status: "HELD", holdExpiresAt: at("10:15") });
      expect(await listed({ zoneId: ids.zoneA })).toEqual(["A-02", "A-03"]);
      clock.set(new Date(at("10:16")));
      expect(await listed({ zoneId: ids.zoneA })).toEqual(["A-01", "A-02", "A-03"]);
    });

    test.each(["CANCELLED", "EXPIRED", "REFUNDED"])("a %s reservation doesn't block the slot", async (status) => {
      await reserve("a1", "14:00", "16:00", { status });
      expect(await listed({ zoneId: ids.zoneA })).toEqual(["A-01", "A-02", "A-03"]);
    });
  });

  describe("time window rules (422)", () => {
    test.each([
      ["has already started", at("09:00"), at("11:00"), /hasn't started/],
      ["starts before opening", at("05:30", "2026-11-03"), at("07:00", "2026-11-03"), /open 06:00–23:00/],
      ["ends after closing", at("22:00"), at("23:30"), /open 06:00–23:00/],
      ["spans two days", at("20:00"), at("08:00", "2026-11-03"), /single day/],
      ["is more than 30 days ahead", at("10:00", "2026-12-05"), at("12:00", "2026-12-05"), /30 days/],
    ])("a window that %s is rejected", async (_what, startTime, endTime, message) => {
      const res = await search({ startTime, endTime });
      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(message);
    });

    test("a window starting a moment ago is still accepted", async () => {
      expect((await search({ startTime: at("09:58"), endTime: at("11:00") })).status).toBe(200);
    });

    test("opening hours are checked in the facility's time zone, not UTC", async () => {
      // 08:30 UTC is 14:00 in India
      expect((await search({ startTime: "2026-11-02T08:30:00Z", endTime: "2026-11-02T10:30:00Z" })).status).toBe(200);
      // 17:45 UTC is 23:15 in India, after closing
      expect((await search({ startTime: "2026-11-02T16:30:00Z", endTime: "2026-11-02T17:45:00Z" })).status).toBe(422);
    });

    test("a window may end exactly at closing time", async () => {
      expect((await search({ startTime: at("21:00"), endTime: at("23:00") })).status).toBe(200);
    });
  });

  describe("invalid requests", () => {
    test("every invalid field is reported at once (400)", async () => {
      const res = await search({ facilityId: "nope", vehicleType: "PLANE", startTime: "tomorrow", endTime: "2026-11-02T14:00:00" });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.details).sort()).toEqual(["endTime", "facilityId", "startTime", "vehicleType"]);
    });

    test("the end must be after the start (400)", async () => {
      const res = await search({ startTime: at("16:00"), endTime: at("14:00") });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ endTime: "End time must be after start time" });
    });

    test("an unknown facility, or a zone of another facility, is 404", async () => {
      expect((await search({ facilityId: new mongoose.Types.ObjectId().toString() })).status).toBe(404);
      const res = await search({ zoneId: ids.zoneX });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe("Zone not found in this facility");
    });
  });

  describe("access", () => {
    test("only drivers can search; staff get 403, no token 401", async () => {
      expect((await search({}, "ATTENDANT")).status).toBe(403);
      expect((await search({}, "ADMIN")).status).toBe(403);
      expect((await api.get("/api/slots/available")).status).toBe(401);
    });

    test("any logged-in user can list facilities with their zones", async () => {
      const res = await api.get("/api/facilities").set("authorization", `Bearer ${tokens.DRIVER}`);
      expect(res.status).toBe(200);
      expect(res.body.facilities.map((f) => f.name)).toEqual(["City Centre", "Other Lot"]);
      expect(res.body.facilities[0].zones).toEqual([{ id: ids.zoneA, name: "Zone A" }, { id: ids.zoneB, name: "Zone B" }]);
      expect((await api.get("/api/facilities")).status).toBe(401);
    });
  });
});

test("localParts converts an instant to local date and time", () => {
  expect(localParts(new Date("2026-11-02T08:30:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-11-02", time: "14:00" });
  expect(localParts(new Date("2026-11-02T20:00:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-11-03", time: "01:30" });
});
