// SRS §4.2 Vehicle Exit & Fee Calculation — VPS-F-010 to VPS-F-013
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, setClock, hardwareCommands, signedWebhook, payAndConfirm,
  enterVehicle } = require("../helpers/api");
const { expectedFee } = require("../helpers/fixture");

const ENTRY_TIME = "2026-11-02T10:00:00+05:30";
const minutesAfterEntry = (m) => new Date(Date.parse(ENTRY_TIME) + m * 60000).toISOString();

describeApi("Vehicle Exit & Fee Calculation", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin({ now: ENTRY_TIME })));

  const park = async (plateNumber = "KA01AB1234") =>
    (await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber })).body.sessionId;

  test.each([30, 60, 61, 165])("TC-Exit-01 [VPS-F-010]: fee for %i minutes = duration × rate", async (minutes) => {
    const sessionId = await park();
    await setClock(minutesAfterEntry(minutes));
    const res = await api.post(C.exit, { gateId: ids.gateOut, sessionId }, { token: tokens.attendant });
    expect(res.status).toBe(402); // unpaid, so the fee is quoted and the barrier stays shut
    expect(res.body.amount).toBe(expectedFee(minutes));
  });

  test("TC-Exit-02 [VPS-F-011]: barrier opens only after payment status = Confirmed", async () => {
    const sessionId = await park();
    await setClock(minutesAfterEntry(90));
    const exitReq = () => api.post(C.exit, { gateId: ids.gateOut, sessionId }, { token: tokens.attendant });
    const opens = async () => (await hardwareCommands(ids.gateOut)).filter((c) => c.command === "OPEN").length;

    expect((await exitReq()).status).toBe(402);

    const pay = await api.post(C.payments, { sessionId, method: "AT_GATE", gatewayToken: "tok_sandbox_visa" },
      { token: tokens.attendant });
    expect(OK).toContain(pay.status);
    expect((await exitReq()).status).toBe(402); // payment created but not yet confirmed by the gateway
    expect(await opens()).toBe(0);

    await signedWebhook({ paymentId: pay.body.paymentId, status: "CONFIRMED" });
    const done = await exitReq();
    expect(done.status).toBe(200);
    expect(done.body.paymentStatus).toMatch(/confirmed/i);
    expect(await opens()).toBe(1);
  });

  test("TC-Exit-03 [VPS-F-012]: slot is Available within 2 seconds of exit confirmation", async () => {
    const entry = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    const { sessionId, slotId } = entry.body;
    await setClock(minutesAfterEntry(45));
    await payAndConfirm(tokens.attendant, { sessionId });

    const exit = await api.post(C.exit, { gateId: ids.gateOut, sessionId }, { token: tokens.attendant });
    expect(exit.status).toBe(200);
    const confirmedAt = Date.now();
    let status;
    while (Date.now() - confirmedAt <= 2000) {
      status = (await api.get(C.slot(slotId ?? ids.carNear), { token: tokens.admin })).body.status;
      if (status === "AVAILABLE") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe("AVAILABLE");
  });

  test("TC-Exit-04 [VPS-F-013]: receipt fields match the session record", async () => {
    const sessionId = await park();
    await setClock(minutesAfterEntry(125));
    await payAndConfirm(tokens.attendant, { sessionId });
    const exit = await api.post(C.exit, { gateId: ids.gateOut, sessionId }, { token: tokens.attendant });
    expect(exit.status).toBe(200);

    const receipt = await api.get(C.receipt(exit.body.receiptId), { token: tokens.attendant });
    const session = await api.get(C.session(sessionId), { token: tokens.attendant });
    expect(receipt.status).toBe(200);
    expect(receipt.body.entryTime).toBe(session.body.entryTime);
    expect(receipt.body.exitTime).toBe(session.body.exitTime);
    expect(receipt.body.duration).toBe(exit.body.duration);
    expect(receipt.body.amount).toBe(expectedFee(125));
  });

  test("API /api/exit: unknown session returns 404", async () => {
    const res = await api.post(C.exit, { gateId: ids.gateOut, sessionId: "000000000000000000000000" },
      { token: tokens.attendant });
    expect(res.status).toBe(404);
  });
});
