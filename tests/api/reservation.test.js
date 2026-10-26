// SRS §4.3 Slot Reservation / Online Pre-booking — VPS-F-020 to VPS-F-023
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, setClock } = require("../helpers/api");

const window = (start, end) => ({ startTime: `2026-11-02T${start}:00+05:30`, endTime: `2026-11-02T${end}:00+05:30` });

describeApi("Slot Reservation / Online Pre-booking", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin()));

  const reserve = (token, vehicleId, w, where = { facilityId: ids.main, zoneId: ids.zoneA }) =>
    api.post(C.reservations, { vehicleId, ...where, ...w }, { token });
  const search = (w, where = { facilityId: ids.main, zoneId: ids.zoneA }) =>
    api.get(`${C.availableSlots}?${new URLSearchParams({ ...where, vehicleType: "CAR", ...w })}`, { token: tokens.driver });

  test("TC-Res-01 [VPS-F-020]: driver reserves a slot and it is not offered to others", async () => {
    const w = window("14:00", "16:00");
    const res = await reserve(tokens.driver, ids.car1, w);
    expect(OK).toContain(res.status);
    expect(res.body).toEqual(expect.objectContaining({
      reservationId: expect.any(String), slotId: expect.any(String),
      status: expect.any(String), holdExpiresAt: expect.any(String),
    }));
    const others = await search(w);
    expect(others.body.slots.map((s) => s.slotId)).not.toContain(res.body.slotId);
  });

  // TC-Res-02 (slot search) is in slots.test.js

  test("TC-Res-03 [VPS-F-022]: hold is released after the grace period if the driver does not arrive", async () => {
    const w = window("10:30", "12:00");
    const res = await reserve(tokens.driver, ids.car1, w, { facilityId: ids.small, zoneId: ids.zoneS });
    expect(OK).toContain(res.status);

    await setClock(new Date(Date.parse(res.body.holdExpiresAt) + 60000).toISOString());
    const after = await api.get(C.reservation(res.body.reservationId), { token: tokens.driver });
    expect(after.body.status).toBe("EXPIRED");
    const free = await search(window("11:00", "12:00"), { facilityId: ids.small, zoneId: ids.zoneS });
    expect(free.body.slots.map((s) => s.slotId)).toContain(ids.onlySlot);
  });

  test("TC-Res-04 [VPS-F-023]: bookings over capacity (409) or outside operating hours (422) are rejected", async () => {
    const where = { facilityId: ids.small, zoneId: ids.zoneS };
    expect(OK).toContain((await reserve(tokens.driver, ids.car1, window("14:00", "16:00"), where)).status);
    const full = await reserve(tokens.driver2, ids.car2, window("15:00", "17:00"), where);
    expect(full.status).toBe(409);

    const late = await reserve(tokens.driver2, ids.car2, window("23:15", "23:45")); // main closes 23:00
    expect(late.status).toBe(422);
  });

  test("API /api/reservations: booking without a token returns 401", async () => {
    const res = await api.post(C.reservations, { vehicleId: ids.car1, facilityId: ids.main, zoneId: ids.zoneA,
      ...window("14:00", "16:00") });
    expect(res.status).toBe(401);
  });
});
