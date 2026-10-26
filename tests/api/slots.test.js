// SRS §4.3 Real-time slot search — VPS-F-021.
// Reservations can't be booked through the API yet, so the overlapping reservation in
// TC-Res-02 is inserted with the /api/test/reservations hook.
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin } = require("../helpers/api");

const at = (time, day = "2026-11-02") => `${day}T${time}:00+05:30`;

describeApi("Real-Time Slot Search", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin()));

  const search = (w, where = { facilityId: ids.main, zoneId: ids.zoneA }, token = tokens.driver) =>
    api.get(`${C.availableSlots}?${new URLSearchParams({ ...where, vehicleType: "CAR", ...w })}`, { token });
  const window = (start, end) => ({ startTime: at(start), endTime: at(end) });

  test("TC-Res-02 [VPS-F-021]: search lists only slots free for the whole window", async () => {
    const res = await search(window("14:00", "16:00"));
    expect(res.status).toBe(200);
    const listed = res.body.slots.map((s) => s.slotId);
    expect(listed).toEqual([ids.carNear, ids.carFar]); // nearest first
    expect(listed).not.toContain(ids.bikeNearest); //    wrong vehicle type
    expect(listed).not.toContain(ids.carOccupied); //    a vehicle is parked there now

    // a reservation overlapping only part of the window removes that slot from the results
    const booked = await api.post(C.test.reservations, { slotId: ids.carNear, ...window("15:00", "17:00") });
    expect(OK).toContain(booked.status);
    const overlap = await search(window("14:00", "16:00"));
    expect(overlap.body.slots.map((s) => s.slotId)).toEqual([ids.carFar]);

    // ...but not from a window that only touches it
    const after = await search(window("17:00", "19:00"));
    expect(after.body.slots.map((s) => s.slotId)).toEqual([ids.carNear, ids.carFar]);
  });

  test("TC-Res-02 [VPS-F-021]: windows outside opening hours or in the past are rejected with 422", async () => {
    expect((await search(window("22:00", "23:30"))).status).toBe(422); // main closes 23:00
    expect((await search(window("08:00", "09:00"))).status).toBe(422); // clock is 10:00
  });

  test("API /api/slots/available: a driver sees facilities and zones to search, staff can't search", async () => {
    const list = await api.get(C.facilities, { token: tokens.driver });
    expect(list.status).toBe(200);
    const main = list.body.facilities.find((f) => f.id === ids.main);
    expect(main.zones.map((z) => z.id)).toEqual([ids.zoneA]);

    expect((await search(window("14:00", "16:00"), undefined, tokens.attendant)).status).toBe(403);
    expect((await api.get(`${C.availableSlots}?facilityId=${ids.main}`)).status).toBe(401);
  });
});
