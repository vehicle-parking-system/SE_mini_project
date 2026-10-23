// Login security & account lockout (VPS-SR-005) against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
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
const EMAIL = "driver@example.com";

describeDb("login security & account lockout", () => {
  const api = request(createApp());
  let adminToken;

  const login = (password, email = EMAIL) => api.post("/api/auth/login").send({ email, password });
  const fail = async (n) => { for (let i = 0; i < n; i++) expect((await login("Wrong1234")).status).toBe(401); };
  const events = (event) => AuditLog.find({ event }).lean();
  const asAdmin = (req) => req.set("authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_lockout";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.reset();
    notifications.clear();
    await createAccount({ name: "Driver", email: EMAIL, password: PASSWORD });
    await createAccount({ name: "Admin", email: "admin@example.com", password: PASSWORD, role: "ADMIN" });
    adminToken = (await login(PASSWORD, "admin@example.com")).body.token;
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test("every failed attempt is tracked with its attempt number", async () => {
    await fail(2);
    const failed = await events("LOGIN_FAILED");
    expect(failed.map((e) => e.details.attempt).sort()).toEqual([1, 2]);
    expect(failed[0].details).toEqual(expect.objectContaining({ reason: "WRONG_PASSWORD", ip: expect.any(String) }));

    const user = await User.findOne({ email: EMAIL });
    expect(user.failedLoginAttempts).toBe(2);
    expect(user.lastFailedLoginAt).toBeInstanceOf(Date);
  });

  test("the 5th consecutive failure locks the account; the lock is audited, alerted and the owner notified", async () => {
    await fail(4);
    expect(await events("ACCOUNT_LOCKED")).toHaveLength(0);
    await fail(1);

    const [lock] = await events("ACCOUNT_LOCKED");
    expect(lock.details.failedAttempts).toBe(5);
    expect(notifications.sent()).toEqual([expect.objectContaining({ to: EMAIL, channel: "EMAIL", type: "ACCOUNT_LOCKED" })]);

    // even the correct password is refused while locked, and the password isn't checked
    const res = await login(PASSWORD);
    expect(res.status).toBe(423);
    expect(res.body.error.message).toMatch(/locked/i);
    expect(res.body.error.details.lockedUntil).toEqual(expect.any(String));
    expect(await events("LOGIN_BLOCKED")).toHaveLength(1);
  });

  test("a parallel burst of guesses gets at most 5 password checks and locks exactly once", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => login(`Guess${i}abc`)));

    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(results.filter((r) => r.status === 423)).toHaveLength(25);
    expect(await events("LOGIN_FAILED")).toHaveLength(5);
    expect(await events("ACCOUNT_LOCKED")).toHaveLength(1);
    expect(notifications.sent()).toHaveLength(1);
    expect((await login(PASSWORD)).status).toBe(423);
  });

  test("a successful login resets the counter, so only consecutive failures count", async () => {
    await fail(4);
    expect((await login(PASSWORD)).status).toBe(200);
    const user = await User.findOne({ email: EMAIL });
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lastLoginAt).toBeInstanceOf(Date);
    await fail(4);
    expect((await login(PASSWORD)).status).toBe(200);
  });

  test("the lock expires after the lock period and the count starts over", async () => {
    await fail(5);
    clock.set(new Date(Date.now() + 14 * 60000));
    expect((await login(PASSWORD)).status).toBe(423);
    clock.set(new Date(Date.now() + 16 * 60000));
    await fail(4); // a fresh set of 5 attempts
    expect((await login(PASSWORD)).status).toBe(200);
  });

  test("unknown emails are tracked but never lock anything", async () => {
    for (let i = 0; i < 6; i++) expect((await login("Wrong1234", "nobody@example.com")).status).toBe(401);
    const failed = await events("LOGIN_FAILED");
    expect(failed).toHaveLength(6);
    expect(failed[0].details.reason).toBe("UNKNOWN_EMAIL");
    expect(await events("ACCOUNT_LOCKED")).toHaveLength(0);
  });

  describe("admin", () => {
    test("sees locked accounts and can unlock one early", async () => {
      await fail(5);
      const list = await asAdmin(api.get("/api/admin/locked-accounts"));
      expect(list.status).toBe(200);
      const [locked] = list.body.users;
      expect(locked).toEqual(expect.objectContaining({ email: EMAIL, lockedUntil: expect.any(String) }));
      expect(locked).not.toHaveProperty("passwordHash");

      expect((await asAdmin(api.post(`/api/admin/users/${locked.id}/unlock`))).status).toBe(204);
      expect((await login(PASSWORD)).status).toBe(200);
      expect(await events("ACCOUNT_UNLOCKED")).toHaveLength(1);
      expect((await asAdmin(api.get("/api/admin/locked-accounts"))).body.users).toEqual([]);
    });

    test("unlocking an account that isn't locked is 404", async () => {
      const user = await User.findOne({ email: EMAIL });
      expect((await asAdmin(api.post(`/api/admin/users/${user.id}/unlock`))).status).toBe(404);
      expect((await asAdmin(api.post("/api/admin/users/not-an-id/unlock"))).status).toBe(404);
    });

    test("can filter the audit log by several login events", async () => {
      await fail(5);
      const res = await asAdmin(api.get("/api/admin/audit-logs?event=LOGIN_FAILED,ACCOUNT_LOCKED"));
      expect(new Set(res.body.logs.map((l) => l.event))).toEqual(new Set(["LOGIN_FAILED", "ACCOUNT_LOCKED"]));
      expect(res.body.logs).toHaveLength(6);
    });

    test("drivers can't see or unlock locked accounts", async () => {
      await fail(5);
      await createAccount({ name: "Other", email: "other@example.com", password: PASSWORD });
      const token = (await login(PASSWORD, "other@example.com")).body.token;
      const user = await User.findOne({ email: EMAIL });
      expect((await api.get("/api/admin/locked-accounts").set("authorization", `Bearer ${token}`)).status).toBe(403);
      expect((await api.post(`/api/admin/users/${user.id}/unlock`).set("authorization", `Bearer ${token}`)).status).toBe(403);
    });
  });
});
