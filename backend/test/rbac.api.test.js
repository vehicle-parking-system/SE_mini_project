// RBAC enforcement and attendant account management against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createAccount, ensureAdmin } = require("../src/accounts");
const config = require("../src/config");
const AuditLog = require("../src/models/AuditLog");
const User = require("../src/models/User");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;
const PASSWORD = "Secret123";

describeDb("role-based access control", () => {
  const api = request(createApp());
  const tokens = {};

  const as = (role, req) => req.set("authorization", `Bearer ${tokens[role]}`);
  const login = async (email, password = PASSWORD) =>
    (await api.post("/api/auth/login").send({ email, password })).body.token;

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_rbac";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    for (const role of ["DRIVER", "ATTENDANT", "ADMIN"]) {
      const email = `${role.toLowerCase()}@example.com`;
      await createAccount({ name: `Test ${role}`, email, password: PASSWORD, role });
      tokens[role] = await login(email);
    }
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test("each role reaches only the endpoints it is permitted", async () => {
    const matrix = [
      ["get", "/api/users/me", ["DRIVER", "ATTENDANT", "ADMIN"]],
      ["post", "/api/users/me/vehicles", ["DRIVER"]],
      ["get", "/api/admin/audit-logs", ["ADMIN"]],
      ["get", "/api/admin/attendants", ["ADMIN"]],
    ];
    const failures = [];
    for (const [method, path, allowed] of matrix) {
      for (const role of ["DRIVER", "ATTENDANT", "ADMIN"]) {
        const res = await as(role, api[method](path)).send({ plateNumber: "KA01AB0001", vehicleType: "CAR" });
        const expected = allowed.includes(role) ? "allowed" : 403;
        const got = res.status === 403 ? 403 : res.status === 401 ? 401 : "allowed";
        if (got !== expected) failures.push(`${role} ${method.toUpperCase()} ${path} -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("protected endpoints need a token (401); unknown endpoints are 404 for everyone", async () => {
    expect((await api.get("/api/admin/audit-logs")).status).toBe(401);
    expect((await api.get("/api/users/me")).status).toBe(401);
    expect((await api.get("/api/nope")).status).toBe(404);
    expect((await as("ADMIN", api.get("/api/nope"))).status).toBe(404);
  });

  test("path tricks do not bypass the policy", async () => {
    for (const path of ["/API/admin/audit-logs", "/api/Admin/audit-logs", "/api/admin/audit-logs/", "/api/admin/audit-logs?x=1"]) {
      expect([401, 403, 404]).toContain((await as("DRIVER", api.get(path))).status);
    }
  });

  test("a denied request is recorded as ACCESS_DENIED in the audit log", async () => {
    await as("ATTENDANT", api.get("/api/admin/audit-logs"));
    const [entry] = await AuditLog.find({ event: "ACCESS_DENIED" }).lean();
    expect(entry.details).toEqual({ method: "GET", path: "/api/admin/audit-logs", role: "ATTENDANT" });
  });

  test("a token with an edited role claim, or forged with another key, is rejected", async () => {
    const driver = await User.findOne({ role: "DRIVER" });
    const [header, , signature] = tokens.DRIVER.split(".");
    const payload = Buffer.from(JSON.stringify({ sub: driver.id, role: "ADMIN" })).toString("base64url");
    expect((await api.get("/api/admin/audit-logs").set("authorization", `Bearer ${header}.${payload}.${signature}`)).status).toBe(401);

    const forged = jwt.sign({ role: "ADMIN" }, "not-the-secret", { subject: driver.id });
    expect((await api.get("/api/admin/audit-logs").set("authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  test("a token stops working when the user's role changes", async () => {
    const driver = await User.findOne({ role: "DRIVER" });
    await User.updateOne({ _id: driver._id }, { role: "ATTENDANT" });
    expect((await as("DRIVER", api.get("/api/users/me"))).status).toBe(401);
  });

  test("a validly signed token for a deleted user is rejected", async () => {
    const ghost = jwt.sign({ role: "ADMIN" }, config.jwtSecret, { subject: new mongoose.Types.ObjectId().toString() });
    expect((await api.get("/api/admin/audit-logs").set("authorization", `Bearer ${ghost}`)).status).toBe(401);
  });

  describe("attendant accounts", () => {
    const attendant = { name: "Shift B", email: "shiftb@example.com", password: "Shift@12345" };

    test("admin creates an attendant who logs in with the ATTENDANT role", async () => {
      const res = await as("ADMIN", api.post("/api/admin/attendants")).send(attendant);
      expect(res.status).toBe(201);
      expect(res.body.user).toEqual(expect.objectContaining({ email: attendant.email, role: "ATTENDANT" }));

      const login = await api.post("/api/auth/login").send({ email: attendant.email, password: attendant.password });
      expect(login.body.user.role).toBe("ATTENDANT");
      expect(await AuditLog.exists({ event: "ATTENDANT_CREATED" })).not.toBeNull();

      const list = await as("ADMIN", api.get("/api/admin/attendants"));
      expect(list.body.users.map((u) => u.email)).toContain(attendant.email);
    });

    test("drivers and attendants cannot create attendants", async () => {
      for (const role of ["DRIVER", "ATTENDANT"]) {
        expect((await as(role, api.post("/api/admin/attendants")).send(attendant)).status).toBe(403);
      }
      expect(await User.exists({ email: attendant.email })).toBeNull();
    });

    test("invalid details are rejected with 400 and a duplicate email with 409", async () => {
      expect((await as("ADMIN", api.post("/api/admin/attendants")).send({ name: "X" })).status).toBe(400);
      expect((await as("ADMIN", api.post("/api/admin/attendants")).send({ ...attendant, email: "driver@example.com" })).status).toBe(409);
    });

    test("attendants have no vehicles", async () => {
      expect((await as("ATTENDANT", api.post("/api/users/me/vehicles")).send({ plateNumber: "KA01AB0002", vehicleType: "CAR" })).status).toBe(403);
    });
  });

  describe("ensureAdmin", () => {
    test("creates the first admin once", async () => {
      const first = await ensureAdmin({ email: "Root@Example.com", password: PASSWORD });
      const again = await ensureAdmin({ email: "root@example.com", password: "Different123" });
      expect(first.role).toBe("ADMIN");
      expect(again.id).toBe(first.id);
    });

    test("never promotes an existing non-admin account", async () => {
      expect(await ensureAdmin({ email: "driver@example.com", password: PASSWORD })).toBeNull();
      expect((await User.findOne({ email: "driver@example.com" })).role).toBe("DRIVER");
    });
  });
});
