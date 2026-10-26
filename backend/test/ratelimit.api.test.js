// Per-IP login throttling (VPS-SR-005) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
// A small limit keeps the tests fast, and X-Forwarded-For (with TRUST_PROXY) lets
// one test client act as several IPs.
process.env.LOGIN_IP_MAX_FAILURES = "5";
process.env.LOGIN_IP_WINDOW_MINUTES = "15";
process.env.TRUST_PROXY = "true";
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount } = require("../src/accounts");
const clock = require("../src/clock");
const notifications = require("../src/notifications");
const AuditLog = require("../src/models/AuditLog");
const User = require("../src/models/User");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const PASSWORD = "Secret123";
const IP_A = "203.0.113.10";
const IP_B = "198.51.100.20";

describeDb("per-IP login throttling", () => {
  const api = request(createApp());

  const login = (email, password, ip = IP_A) =>
    api.post("/api/auth/login").set("x-forwarded-for", ip).send({ email, password });
  // credential stuffing: one guess each against different accounts
  const stuff = async (n, ip = IP_A) => {
    for (let i = 0; i < n; i++) expect((await login(`victim${i}@example.com`, "Guess1234", ip)).status).toBe(401);
  };

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_ratelimit";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.reset();
    notifications.clear();
    await createAccount({ name: "Driver", email: "driver@example.com", password: PASSWORD });
    await createAccount({ name: "Admin", email: "admin@example.com", password: PASSWORD, role: "ADMIN" });
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test("after 5 failed logins across different accounts, the IP gets 429 with Retry-After", async () => {
    await stuff(5);
    const res = await login("driver@example.com", PASSWORD); // even a correct password
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(15 * 60);
  });

  test("throttling is audited and admins are alerted once per window", async () => {
    await stuff(5);
    for (let i = 0; i < 3; i++) expect((await login("x@example.com", "Guess1234")).status).toBe(429);

    const limited = await AuditLog.find({ event: "LOGIN_RATE_LIMITED" }).lean();
    expect(limited).toHaveLength(1);
    expect(limited[0].details).toEqual(expect.objectContaining({ ip: IP_A, limit: 5 }));
    expect(notifications.sent()).toEqual([
      expect.objectContaining({ to: "admin@example.com", type: "ADMIN_LOGIN_RATE_LIMITED", data: expect.objectContaining({ ip: IP_A }) }),
    ]);
  });

  test("other IPs are not affected", async () => {
    await stuff(5, IP_A);
    expect((await login("driver@example.com", PASSWORD, IP_B)).status).toBe(200);
  });

  test("successful logins don't use up the limit", async () => {
    for (let i = 0; i < 10; i++) expect((await login("driver@example.com", PASSWORD)).status).toBe(200);
    await stuff(4);
    expect((await login("driver@example.com", PASSWORD)).status).toBe(200);
  });

  test("the limit resets in the next window", async () => {
    await stuff(5);
    expect((await login("driver@example.com", PASSWORD)).status).toBe(429);
    clock.set(new Date(Date.now() + 16 * 60000));
    expect((await login("driver@example.com", PASSWORD)).status).toBe(200);
  });

  test("a parallel burst gets exactly 5 attempts through", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => login(`burst${i}@example.com`, "Guess1234")));
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(20);
    expect(await AuditLog.countDocuments({ event: "LOGIN_RATE_LIMITED" })).toBe(1);
  });

  test("throttled attempts never reach the account: no password check, no account lock", async () => {
    await stuff(5);
    for (let i = 0; i < 10; i++) await login("driver@example.com", "Wrong1234");
    const driver = await User.findOne({ email: "driver@example.com" });
    expect(driver.failedLoginAttempts).toBe(0);
    expect(driver.lockedUntil).toBeNull();
  });
});
