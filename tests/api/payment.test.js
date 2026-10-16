// SRS §4.4 Payment Processing — VPS-F-030 to VPS-F-032, plus webhook checks from Test Plan §5.1
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, signedWebhook, payAndConfirm, enterVehicle } = require("../helpers/api");

const at = (hhmm) => `2026-11-02T${hhmm}:00+05:30`;

describeApi("Payment Processing", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin({ now: at("10:00") })));

  const reserve = (start, end) => api.post(C.reservations, {
    vehicleId: ids.car1, facilityId: ids.main, zoneId: ids.zoneA, startTime: at(start), endTime: at(end),
  }, { token: tokens.driver });
  const transactions = async () => (await api.get(C.transactions, { token: tokens.admin })).body.transactions;

  test("TC-Pay-01 [VPS-F-030]: online payment for a reservation is confirmed only by the signed webhook", async () => {
    const r = await reserve("14:00", "16:00");
    const pay = await api.post(C.payments, { reservationId: r.body.reservationId, method: "ONLINE",
      gatewayToken: "tok_sandbox_visa" }, { token: tokens.driver });
    expect(OK).toContain(pay.status);
    expect(pay.body.status).not.toMatch(/confirmed/i);

    await signedWebhook({ paymentId: pay.body.paymentId, status: "CONFIRMED" });
    const reservation = await api.get(C.reservation(r.body.reservationId), { token: tokens.driver });
    expect(reservation.body.status).toBe("CONFIRMED");

    const sent = (await api.get(C.test.notifications)).body.notifications;
    expect(sent.some((n) => n.to === "driver@test.vps" && /booking/i.test(n.type))).toBe(true);
  });

  test("TC-Pay-01 [VPS-F-030]: at-gate payment for a walk-in exit", async () => {
    const entry = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA05XY0001" });
    await payAndConfirm(tokens.attendant, { sessionId: entry.body.sessionId }, "AT_GATE");
    const exit = await api.post(C.exit, { gateId: ids.gateOut, sessionId: entry.body.sessionId }, { token: tokens.attendant });
    expect(exit.status).toBe(200);
  });

  test("TC-Pay-02 [VPS-F-031]: refund inside the policy window, no refund outside it", async () => {
    // policy: full refund if cancelled at least 60 minutes before the start time
    const early = await reserve("14:00", "16:00");
    await payAndConfirm(tokens.driver, { reservationId: early.body.reservationId }, "ONLINE");
    const late = await reserve("10:30", "11:30");
    await payAndConfirm(tokens.driver, { reservationId: late.body.reservationId }, "ONLINE");

    expect(OK).toContain((await api.post(C.cancelReservation(early.body.reservationId), {}, { token: tokens.driver })).status);
    await api.post(C.cancelReservation(late.body.reservationId), {}, { token: tokens.driver });

    expect((await api.get(C.reservation(early.body.reservationId), { token: tokens.driver })).body.status).toBe("REFUNDED");
    expect((await api.get(C.reservation(late.body.reservationId), { token: tokens.driver })).body.status).not.toBe("REFUNDED");
    expect((await transactions()).filter((t) => /refund/i.test(t.type ?? t.status))).toHaveLength(1);
  });

  test("TC-Pay-03 [VPS-F-032]: every transaction is logged with the gateway reference", async () => {
    const r = await reserve("14:00", "16:00");
    await payAndConfirm(tokens.driver, { reservationId: r.body.reservationId }, "ONLINE");
    await api.post(C.cancelReservation(r.body.reservationId), {}, { token: tokens.driver });

    const log = await transactions();
    expect(log.length).toBeGreaterThanOrEqual(2); // payment + refund
    for (const t of log) {
      expect(t).toEqual(expect.objectContaining({
        gatewayRef: expect.any(String), amount: expect.any(Number), status: expect.any(String), createdAt: expect.any(String),
      }));
    }
  });

  test("Security §5.1: webhook with an invalid signature is rejected and changes nothing", async () => {
    const r = await reserve("14:00", "16:00");
    const pay = await api.post(C.payments, { reservationId: r.body.reservationId, method: "ONLINE",
      gatewayToken: "tok_sandbox_visa" }, { token: tokens.driver });
    const forged = await api.post(C.paymentWebhook, { paymentId: pay.body.paymentId, status: "CONFIRMED" },
      { headers: { [C.webhookSignatureHeader]: "0".repeat(64) } });
    expect([400, 401, 403]).toContain(forged.status);
    expect((await api.get(C.reservation(r.body.reservationId), { token: tokens.driver })).body.status).not.toBe("CONFIRMED");
  });

  test("Security §5.1: replaying a valid webhook does not create a second payment", async () => {
    const r = await reserve("14:00", "16:00");
    const paymentId = await payAndConfirm(tokens.driver, { reservationId: r.body.reservationId }, "ONLINE");
    await signedWebhook({ paymentId, status: "CONFIRMED" });
    const confirmed = (await transactions()).filter((t) => /confirmed|captured|success/i.test(t.status));
    expect(confirmed).toHaveLength(1);
  });
});
