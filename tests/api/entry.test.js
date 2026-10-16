// SRS §4.1 Vehicle Entry & Slot Allocation — VPS-F-001 to VPS-F-004
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, hardwareCommands, enterVehicle } = require("../helpers/api");

describeApi("Vehicle Entry & Slot Allocation", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin()));

  test("TC-Entry-01 [VPS-F-001]: entry via ANPR, QR and manual input each creates a session", async () => {
    const reservation = await api.post(C.reservations, {
      vehicleId: ids.car2, facilityId: ids.main, zoneId: ids.zoneA,
      startTime: "2026-11-02T10:00:00+05:30", endTime: "2026-11-02T12:00:00+05:30",
    }, { token: tokens.driver2 });
    expect(OK).toContain(reservation.status);

    const entries = [
      { source: "ANPR", plateNumber: "KA01AB1234" },
      { source: "QR", qrCode: reservation.body.qrCode ?? reservation.body.reservationId },
      { source: "MANUAL", plateNumber: "KA05XY0001" },
    ];
    for (const e of entries) {
      const res = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, ...e });
      expect(OK).toContain(res.status);
      expect(res.body).toEqual(expect.objectContaining({
        sessionId: expect.any(String), slotNumber: expect.any(String),
        entryTime: expect.any(String), ticketQr: expect.any(String),
      }));
      const session = await api.get(C.session(res.body.sessionId), { token: tokens.attendant });
      expect(session.status).toBe(200);
      expect(session.body.gateId).toBe(ids.gateIn);
      expect(session.body.entryTime).toBeTruthy();
      if (e.plateNumber) expect(session.body.plateNumber).toBe(e.plateNumber);
    }
  });

  test("TC-Entry-02 [VPS-F-002]: nearest free slot of the right type is allocated and locked", async () => {
    const first = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    expect(OK).toContain(first.status);
    // A-01 is occupied and A-B1 is a bike slot, so the nearest free car slot is A-02
    expect(first.body.slotNumber).toBe("A-02");
    const slot = await api.get(C.slot(ids.carNear), { token: tokens.admin });
    expect(slot.body.status).toBe("OCCUPIED");

    const second = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA02CD5678" });
    expect(second.body.slotNumber).toBe("A-03");
  });

  test("TC-Entry-02 [VPS-F-002] concurrency: one free slot is never given to two vehicles", async () => {
    const attempts = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      enterVehicle(tokens.attendant, { gateId: ids.smallIn, plateNumber: `KA09ZZ${String(i).padStart(4, "0")}` })));
    const allocated = attempts.filter((r) => OK.includes(r.status));
    expect(allocated).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(19);
  });

  test("TC-Entry-03 [VPS-F-003]: entry rejected with 'Facility Full' and barrier stays closed", async () => {
    const fill = await enterVehicle(tokens.attendant, { gateId: ids.smallIn, plateNumber: "KA01AB1234" });
    expect(OK).toContain(fill.status);
    const before = await api.get(C.occupancy(ids.small), { token: tokens.admin });
    const opensBefore = (await hardwareCommands(ids.smallIn)).filter((c) => c.command === "OPEN").length;

    const rejected = await enterVehicle(tokens.attendant, { gateId: ids.smallIn, plateNumber: "KA02CD5678" });
    expect(rejected.status).toBe(409);

    const after = await api.get(C.occupancy(ids.small), { token: tokens.admin });
    expect(after.body.occupied).toBe(before.body.occupied);
    const commands = await hardwareCommands(ids.smallIn);
    expect(commands.filter((c) => c.command === "OPEN")).toHaveLength(opensBefore);
    expect(commands.some((c) => c.command === "DISPLAY" && /facility full/i.test(c.message))).toBe(true);
  });

  test("TC-Entry-04 [VPS-F-004]: entry ticket has session ID, entry time and slot, and scans at exit", async () => {
    const entry = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    const scan = await api.post(C.ticketScan, { qrCode: entry.body.ticketQr }, { token: tokens.attendant });
    expect(scan.status).toBe(200);
    expect(scan.body).toEqual(expect.objectContaining({
      sessionId: entry.body.sessionId, entryTime: entry.body.entryTime, slotNumber: entry.body.slotNumber,
    }));
  });

  test("API /api/entry: invalid ticket returns 400 and the barrier stays closed", async () => {
    const res = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, source: "QR", qrCode: "not-a-valid-ticket" });
    expect(res.status).toBe(400);
    expect((await hardwareCommands(ids.gateIn)).filter((c) => c.command === "OPEN")).toHaveLength(0);
  });
});
