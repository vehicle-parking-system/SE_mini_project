// SRS §4.5 Admin, Attendant & Reporting — VPS-F-040 to VPS-F-043
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, login, setClock, hardwareCommands, payAndConfirm,
  enterVehicle } = require("../helpers/api");

const at = (hhmm) => `2026-11-02T${hhmm}:00+05:30`;

describeApi("Admin, Attendant & Reporting", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin({ now: at("10:00") })));

  test("TC-Admin-01 [VPS-F-040]: admin configures a lot, zone and slots; a deactivated slot is never allocated", async () => {
    const created = await api.post(C.adminFacilities, {
      name: "North Lot", openTime: "06:00", closeTime: "22:00",
      zones: [{ name: "N1", slots: [{ number: "N-01", vehicleType: "CAR", distance: 5 }, { number: "N-02", vehicleType: "CAR", distance: 9 }] }],
    }, { token: tokens.admin });
    expect(OK).toContain(created.status);

    expect((await api.patch(C.adminSlot(ids.carNear), { active: false }, { token: tokens.admin })).status).toBe(200);
    const entry = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    expect(entry.body.slotNumber).toBe("A-03"); // A-02 is nearer but inactive
  });

  test("TC-Admin-02 [VPS-F-041]: a changed rate is used for later fee calculations", async () => {
    const rate = await api.put(C.adminRates, { facilityId: ids.main, zoneId: ids.zoneA, vehicleType: "CAR", ratePerHour: 60 },
      { token: tokens.admin });
    expect(OK).toContain(rate.status);
    const entry = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    await setClock(at("12:00"));
    const exit = await api.post(C.exit, { gateId: ids.gateOut, sessionId: entry.body.sessionId }, { token: tokens.attendant });
    expect(exit.body.amount).toBe(120);
  });

  test("TC-Admin-03 [VPS-F-042]: new attendant performs a manual override, recorded in the audit log", async () => {
    const created = await api.post(C.adminAttendants, { name: "Shift B", email: "shiftb@test.vps", password: "Shift@12345" },
      { token: tokens.admin });
    expect(OK).toContain(created.status);
    expect(created.body.user.role).toBe("ATTENDANT");
    const attendant = await login("shiftb@test.vps", "Shift@12345");

    const entry = await enterVehicle(attendant, { gateId: ids.gateIn, plateNumber: "KA07MN4321", source: "MANUAL" });
    expect(OK).toContain(entry.status);
    expect((await hardwareCommands(ids.gateIn)).some((c) => c.command === "OPEN")).toBe(true);

    const override = await api.post(`/api/gates/${ids.gateOut}/override`,
      { action: "OPEN", reason: "SCANNER_FAILURE", note: "Scanner unreadable during test" }, { token: attendant });
    expect(override.status).toBe(200);
    expect(override.body.delivered).toBe(true);
    expect((await hardwareCommands(ids.gateOut)).some((c) => c.command === "OPEN")).toBe(true);
    const logs = await api.get(`${C.auditLogs}?event=MANUAL_OVERRIDE`, { token: tokens.admin });
    expect(logs.body.logs).toEqual(expect.arrayContaining([expect.objectContaining({
      actorId: created.body.user.id, actorEmail: "shiftb@test.vps",
      details: expect.objectContaining({ kind: "BARRIER", action: "OPEN", reason: "SCANNER_FAILURE", gateId: ids.gateOut }),
    })]));
  });

  test("TC-Admin-04 [VPS-F-043]: occupancy, revenue and usage reports match the data and export as CSV", async () => {
    const entry = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    await setClock(at("11:30"));
    await payAndConfirm(tokens.attendant, { sessionId: entry.body.sessionId });
    await api.post(C.exit, { gateId: ids.gateOut, sessionId: entry.body.sessionId }, { token: tokens.attendant });

    const q = `facilityId=${ids.main}&from=2026-11-02&to=2026-11-02`;
    const revenue = await api.get(`${C.report("revenue")}?${q}&format=json`, { token: tokens.admin });
    expect(revenue.status).toBe(200);
    expect(revenue.body.total).toBe(80); // 1h30m at ₹40 per started hour

    for (const type of ["occupancy", "revenue", "usage"]) {
      const csv = await api.get(`${C.report(type)}?${q}&format=csv`, { token: tokens.admin, raw: true });
      expect(csv.status).toBe(200);
      expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
      expect(csv.body.trim().split("\n").length).toBeGreaterThan(1); // header + at least one row
    }
  });
});
