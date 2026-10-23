// SRS §5.1.2 Security Requirements and Test Plan §5.1 Security Validation.
// TC-Sec-02 (TLS) needs a deployed HTTPS URL and runs in the nightly workflow instead.
const fs = require("fs");
const { MongoClient } = require("mongodb");
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, login, enterVehicle } = require("../helpers/api");
const { PASSWORD } = require("../helpers/fixture");

const SANDBOX_CARD = "4111111111111111";
const describeDb = process.env.API_URL && process.env.MONGO_URL ? describe : describe.skip;
const describeLogs = process.env.API_URL && process.env.BACKEND_LOG ? describe : describe.skip;

async function dumpDatabase() {
  const client = await MongoClient.connect(process.env.MONGO_URL);
  try {
    const db = client.db();
    const dump = {};
    for (const { name } of await db.listCollections().toArray()) dump[name] = await db.collection(name).find().toArray();
    return dump;
  } finally {
    await client.close();
  }
}

// Luhn-valid 13–19 digit runs = possible card numbers
function cardNumbersIn(text) {
  const luhn = (n) => [...n].reverse().reduce((sum, d, i) => {
    let v = Number(d) * (i % 2 ? 2 : 1);
    return sum + (v > 9 ? v - 9 : v);
  }, 0) % 10 === 0;
  return (text.match(/\b\d{13,19}\b/g) || []).filter(luhn);
}

describeApi("Security", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin()));

  // [method, path builder, body, roles allowed]
  const matrix = () => [
    ["POST", C.reservations, { vehicleId: ids.car1, facilityId: ids.main, zoneId: ids.zoneA,
      startTime: "2026-11-02T14:00:00+05:30", endTime: "2026-11-02T15:00:00+05:30" }, ["driver"]],
    ["POST", C.entry, { gateId: ids.gateIn, plateNumber: "KA01AB1234", vehicleType: "CAR", source: "MANUAL" }, ["attendant", "admin"]],
    ["GET", C.occupancy(ids.main), undefined, ["attendant", "admin"]],
    ["GET", C.transactions, undefined, ["admin"]],
    ["GET", C.auditLogs, undefined, ["admin"]],
    ["GET", `${C.report("revenue")}?facilityId=${ids.main}&format=json`, undefined, ["admin"]],
    ["PUT", C.adminRates, { facilityId: ids.main, zoneId: ids.zoneA, vehicleType: "CAR", ratePerHour: 40 }, ["admin"]],
    ["POST", C.adminAttendants, { name: "X", email: "x@test.vps", password: "X@123456789" }, ["admin"]],
  ];

  test("TC-Sec-04 [VPS-SR-003]: RBAC matrix — each role can call only the functions permitted to it", async () => {
    const failures = [];
    for (const [method, path, body, allowed] of matrix()) {
      for (const role of ["driver", "attendant", "admin"]) {
        const res = await (method === "GET" ? api.get(path, { token: tokens[role] })
          : api[method.toLowerCase()](path, body, { token: tokens[role] }));
        const permitted = ![401, 403].includes(res.status);
        if (permitted !== allowed.includes(role)) failures.push(`${role} ${method} ${path} -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("TC-Sec-04 [VPS-SR-003]: a JWT whose role claim was edited is rejected", async () => {
    const [header, payload, signature] = tokens.driver.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    claims.role = "ADMIN";
    const forged = [header, Buffer.from(JSON.stringify(claims)).toString("base64url"), signature].join(".");
    expect([401, 403]).toContain((await api.get(C.transactions, { token: forged })).status);
  });

  test("TC-Sec-04 [VPS-SR-003]: an admin-created attendant has the attendant role and is denied driver and admin functions", async () => {
    const created = await api.post(C.adminAttendants, { name: "Gate Staff", email: "gate@test.vps", password: "Gate@12345" },
      { token: tokens.admin });
    expect(OK).toContain(created.status);
    const token = await login("gate@test.vps", "Gate@12345");

    expect((await api.get(C.me, { token })).body.user.role).toBe("ATTENDANT");
    expect((await api.post(C.myVehicles, { plateNumber: "KA01ZZ0001", vehicleType: "CAR" }, { token })).status).toBe(403);
    expect((await api.get(C.auditLogs, { token })).status).toBe(403);
    expect((await api.post(C.adminAttendants, { name: "Y", email: "y@test.vps", password: "Y@1234567" }, { token })).status).toBe(403);

    const denied = await api.get(`${C.auditLogs}?event=ACCESS_DENIED`, { token: tokens.admin });
    expect(denied.body.logs.length).toBeGreaterThanOrEqual(3);
  });

  test("TC-Sec-04 [VPS-SR-003]: self-registration cannot create staff accounts", async () => {
    const res = await api.post(C.register, { name: "Sneaky", email: "sneaky@test.vps", phone: "9000000002",
      password: PASSWORD, role: "ADMIN" });
    expect(OK).toContain(res.status);
    expect((await api.get(C.transactions, { token: res.body.token })).status).toBe(403);
  });

  test("TC-Sec-06 [VPS-SR-005]: account locks after 5 failed logins and an alert is logged", async () => {
    for (let i = 0; i < 5; i++) expect((await api.post(C.login, { email: "driver@test.vps", password: "wrong" })).status).toBe(401);
    const locked = await api.post(C.login, { email: "driver@test.vps", password: PASSWORD });
    expect(locked.status).not.toBe(200);
    expect([401, 403, 423]).toContain(locked.status);

    const logs = await api.get(`${C.auditLogs}?event=ACCOUNT_LOCKED`, { token: tokens.admin });
    expect(logs.body.logs.length).toBeGreaterThanOrEqual(1);
  });
  test("TC-Sec-06 [VPS-SR-005]: each failed attempt is logged and the owner is notified of the lock", async () => {
    for (let i = 0; i < 5; i++) await api.post(C.login, { email: "driver@test.vps", password: "wrong" });

    const failed = await api.get(`${C.auditLogs}?event=LOGIN_FAILED`, { token: tokens.admin });
    expect(failed.body.logs.filter((l) => l.actorId === ids.driver)).toHaveLength(5);
    const sent = await api.get(C.test.notifications);
    expect(sent.body.notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ to: "driver@test.vps", type: "ACCOUNT_LOCKED" })]));
  });

  test("TC-Sec-06 [VPS-SR-005]: parallel guessing cannot get more than 5 password checks", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      api.post(C.login, { email: "driver@test.vps", password: `Guess@${i}xyz` })));
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect((await api.post(C.login, { email: "driver@test.vps", password: PASSWORD })).status).not.toBe(200);
  });

  test("TC-Sec-06 [VPS-SR-005]: an admin sees the locked account and can unlock it", async () => {
    for (let i = 0; i < 5; i++) await api.post(C.login, { email: "driver@test.vps", password: "wrong" });
    const locked = await api.get(C.lockedAccounts, { token: tokens.admin });
    expect(locked.body.users.map((u) => u.id)).toEqual([ids.driver]);

    expect((await api.post(C.unlockUser(ids.driver), undefined, { token: tokens.driver2 })).status).toBe(403);
    expect((await api.post(C.unlockUser(ids.driver), undefined, { token: tokens.admin })).status).toBe(204);
    expect((await api.post(C.login, { email: "driver@test.vps", password: PASSWORD })).status).toBe(200);
  });
});

describeDb("Security — database review", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin()));

  test("TC-Sec-03 [VPS-SR-002]: passwords are stored as salted bcrypt/argon2 hashes, never plaintext", async () => {
    const res = await api.post(C.register, { name: "New Driver", email: "new@test.vps", phone: "9000000000",
      password: PASSWORD, vehicles: [{ plateNumber: "KA03EF9999", vehicleType: "CAR" }] });
    expect(OK).toContain(res.status);

    const dump = await dumpDatabase();
    const users = dump[C.collections.users];
    const hashes = users.map((u) => u[C.collections.passwordField]);
    for (const h of hashes) expect(h).toMatch(/^\$2[aby]\$\d{2}\$|^\$argon2(id|i|d)\$/);
    expect(new Set(hashes).size).toBe(hashes.length); // same password, different salts
    expect(JSON.stringify(dump)).not.toContain(PASSWORD);
  });

  test("TC-Sec-05 [VPS-SR-004] / TC-Sec-01 [VPS-NF-003]: no card numbers are stored, only gateway tokens", async () => {
    const r = await api.post(C.reservations, { vehicleId: ids.car1, facilityId: ids.main, zoneId: ids.zoneA,
      startTime: "2026-11-02T14:00:00+05:30", endTime: "2026-11-02T15:00:00+05:30" }, { token: tokens.driver });
    // a misbehaving client sends the raw card number along with the token
    await api.post(C.payments, { reservationId: r.body.reservationId, method: "ONLINE", gatewayToken: "tok_sandbox_visa",
      cardNumber: SANDBOX_CARD }, { token: tokens.driver });

    expect(cardNumbersIn(JSON.stringify(await dumpDatabase()))).toEqual([]);
  });
});

describeLogs("Security — log review", () => {
  test("TC-Sec-01 [VPS-NF-003]: logs contain no passwords, tokens or card data", async () => {
    const { ids, tokens } = await resetAndLogin();
    await api.post(C.login, { email: "driver@test.vps", password: "Wrong@Password1" });
    await enterVehicle(tokens.attendant, { gateId: ids.gateIn, plateNumber: "KA01AB1234" });
    await api.post(C.payments, { method: "ONLINE", gatewayToken: "tok_sandbox_visa", cardNumber: SANDBOX_CARD },
      { token: tokens.driver });

    const log = fs.readFileSync(process.env.BACKEND_LOG, "utf8");
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain("Wrong@Password1");
    for (const t of Object.values(tokens)) expect(log).not.toContain(t);
    expect(cardNumbersIn(log)).toEqual([]);
  });
});
