// Registration, login, lockout and profile management against a real MongoDB.
// Uses MONGO_URL with its own database name; skipped when MONGO_URL is not set.
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const clock = require("../src/clock");
const User = require("../src/models/User");

const MONGO_URL = process.env.MONGO_URL;
const describeDb = MONGO_URL ? describe : describe.skip;

const driver = {
  name: "Asha Rao", email: "asha@example.com", phone: "9876543210", password: "Secret123",
  vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }],
};

describeDb("driver registration, login and profile", () => {
  const app = createApp();
  const api = request(app);

  beforeAll(async () => {
    const url = new URL(MONGO_URL);
    url.pathname = "/vps_backend_unit";
    await mongoose.connect(url.toString());
  });
  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clock.reset();
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  const register = (body = driver) => api.post("/api/auth/register").send(body);
  const login = (email = driver.email, password = driver.password) => api.post("/api/auth/login").send({ email, password });

  describe("registration", () => {
    test("creates a DRIVER account with vehicles and returns a token", async () => {
      const res = await register();
      expect(res.status).toBe(201);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user).toEqual(expect.objectContaining({ name: "Asha Rao", email: "asha@example.com", role: "DRIVER" }));
      expect(res.body.user).not.toHaveProperty("passwordHash");
      expect(res.body.vehicles).toEqual([expect.objectContaining({ plateNumber: "KA01AB1234", vehicleType: "CAR" })]);

      const stored = await User.findOne({ email: driver.email }).lean();
      expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    test("cannot be used to create staff accounts", async () => {
      const res = await register({ ...driver, role: "ADMIN" });
      expect(res.body.user.role).toBe("DRIVER");
    });

    test("rejects invalid input with 400 and per-field details", async () => {
      const res = await register({ ...driver, email: "bad", password: "short" });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.details).sort()).toEqual(["email", "password"]);
    });

    test("rejects a duplicate email (any case) with 409", async () => {
      await register();
      const res = await register({ ...driver, email: "ASHA@example.com", vehicles: [] });
      expect(res.status).toBe(409);
    });

    test("rejects a plate already registered to someone else with 409 and creates no account", async () => {
      await register();
      const res = await register({ ...driver, email: "other@example.com", vehicles: [{ plateNumber: "ka01ab1234", vehicleType: "CAR" }] });
      expect(res.status).toBe(409);
      expect(await User.exists({ email: "other@example.com" })).toBeNull();
    });
  });

  describe("login", () => {
    beforeEach(() => register());

    test("returns a token and the user's id and role", async () => {
      const res = await login(" Asha@Example.com ");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ token: expect.any(String), user: expect.objectContaining({ id: expect.any(String), role: "DRIVER" }) });
    });

    test("wrong password and unknown email get the same 401", async () => {
      const wrong = await login(driver.email, "Wrong1234");
      const unknown = await login("nobody@example.com", "Wrong1234");
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    test("locks the account after 5 consecutive failures, then unlocks after the lock period", async () => {
      for (let i = 0; i < 5; i++) expect((await login(driver.email, "Wrong1234")).status).toBe(401);
      expect((await login()).status).toBe(423);

      clock.set(new Date(Date.now() + 16 * 60000));
      expect((await login()).status).toBe(200);
    });

    test("a successful login resets the failure count", async () => {
      for (let i = 0; i < 4; i++) await login(driver.email, "Wrong1234");
      expect((await login()).status).toBe(200);
      for (let i = 0; i < 4; i++) await login(driver.email, "Wrong1234");
      expect((await login()).status).toBe(200);
    });
  });

  describe("profile", () => {
    let token;
    beforeEach(async () => ({ body: { token } } = await register()));
    const auth = (req) => req.set("authorization", `Bearer ${token}`);

    test("requires a valid token", async () => {
      expect((await api.get("/api/users/me")).status).toBe(401);
      expect((await api.get("/api/users/me").set("authorization", "Bearer nope")).status).toBe(401);
    });

    test("returns the profile and vehicles", async () => {
      const res = await auth(api.get("/api/users/me"));
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(driver.email);
      expect(res.body.vehicles).toHaveLength(1);
    });

    test("updates name and phone but not email or role", async () => {
      const res = await auth(api.patch("/api/users/me")).send({ name: "Asha R", phone: "9123456789", role: "ADMIN" });
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(expect.objectContaining({ name: "Asha R", phone: "9123456789", role: "DRIVER" }));
    });

    test("adds and removes vehicles", async () => {
      const added = await auth(api.post("/api/users/me/vehicles")).send({ plateNumber: "MH12DE1433", vehicleType: "BIKE" });
      expect(added.status).toBe(201);
      expect((await auth(api.get("/api/users/me"))).body.vehicles).toHaveLength(2);

      expect((await auth(api.delete(`/api/users/me/vehicles/${added.body.vehicle.id}`))).status).toBe(204);
      expect((await auth(api.delete(`/api/users/me/vehicles/${added.body.vehicle.id}`))).status).toBe(404);
      expect((await auth(api.delete("/api/users/me/vehicles/not-an-id"))).status).toBe(404);
    });

    test("cannot delete another driver's vehicle", async () => {
      const other = await register({ ...driver, email: "b@example.com", vehicles: [{ plateNumber: "DL3CAB0001", vehicleType: "CAR" }] });
      const res = await auth(api.delete(`/api/users/me/vehicles/${other.body.vehicles[0].id}`));
      expect(res.status).toBe(404);
    });

    test("changes the password only with the current password", async () => {
      const bad = await auth(api.post("/api/users/me/password")).send({ currentPassword: "Wrong1234", newPassword: "NewSecret1" });
      expect(bad.status).toBe(400);
      const ok = await auth(api.post("/api/users/me/password")).send({ currentPassword: driver.password, newPassword: "NewSecret1" });
      expect(ok.status).toBe(204);
      expect((await login()).status).toBe(401);
      expect((await login(driver.email, "NewSecret1")).status).toBe(200);
    });
  });

  test("audit logs are admin-only", async () => {
    const { body: { token } } = await register();
    expect((await api.get("/api/admin/audit-logs").set("authorization", `Bearer ${token}`)).status).toBe(403);
  });
});
