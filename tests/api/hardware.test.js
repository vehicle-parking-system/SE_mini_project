// Test Plan §10 risk "Network loss to gate controllers": local queuing with retry/backoff
// and manual attendant override (SRS §2.5, §3.4; SAD §3.7).
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, hardwareCommands, enterVehicle } = require("../helpers/api");

describeApi("Hardware resilience", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin()));
  afterEach(() => api.post(C.test.hardwareLink, { gateId: ids.gateIn, up: true }));

  test("Risk: gate command is queued during network loss and executed once when the link returns", async () => {
    await api.post(C.test.hardwareLink, { gateId: ids.gateIn, up: false });
    const entry = await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    expect(OK).toContain(entry.status); // session is still created
    expect((await hardwareCommands(ids.gateIn)).filter((c) => c.command === "OPEN")).toHaveLength(0);

    await api.post(C.test.hardwareLink, { gateId: ids.gateIn, up: true });
    let opens = 0;
    for (let i = 0; i < 50 && opens === 0; i++) { // retry/backoff: allow up to ~10 s
      await new Promise((r) => setTimeout(r, 200));
      opens = (await hardwareCommands(ids.gateIn)).filter((c) => c.command === "OPEN").length;
    }
    expect(opens).toBe(1);
  });
});
