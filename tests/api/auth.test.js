// SRS §2.2 Driver registration, authentication, and profile/vehicle management.
// User story: as a Driver / Vehicle Owner I want to register and log in, so that I can
// manage my profile, search for parking slots, and make online reservations.
const C = require("../contract");
const { describeApi, api, OK, resetAndLogin, login } = require("../helpers/api");

const newDriver = {
  name: "New Driver", email: "new.driver@test.vps", phone: "9000000001", password: "Driver@2026",
  vehicles: [{ plateNumber: "KA05MN4321", vehicleType: "CAR" }],
};

describeApi("Driver registration & login", () => {
  let ids, tokens;
  beforeEach(async () => ({ ids, tokens } = await resetAndLogin()));

  test("API /api/auth/register: a driver registers with a vehicle and can log in", async () => {
    const reg = await api.post(C.register, newDriver);
    expect(OK).toContain(reg.status);
    expect(reg.body.user).toEqual(expect.objectContaining({ email: newDriver.email, role: "DRIVER" }));

    const token = await login(newDriver.email, newDriver.password);
    const me = await api.get(C.me, { token });
    expect(me.status).toBe(200);
    expect(me.body.vehicles.map((v) => v.plateNumber)).toEqual(["KA05MN4321"]);
  });

  test("API /api/auth/register: duplicate email or plate is rejected with 409, bad input with 400", async () => {
    expect((await api.post(C.register, { ...newDriver, email: "driver@test.vps", vehicles: [] })).status).toBe(409);
    expect((await api.post(C.register, { ...newDriver, vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }] })).status).toBe(409);
    expect((await api.post(C.register, { ...newDriver, email: "not-an-email" })).status).toBe(400);
  });

  test("API /api/auth/login: wrong password returns 401", async () => {
    expect((await api.post(C.login, { email: "driver@test.vps", password: "Wrong@Password1" })).status).toBe(401);
  });

  test("API /api/users/me: a driver views and edits their profile and vehicles", async () => {
    const me = await api.get(C.me, { token: tokens.driver });
    expect(me.body.user.id).toBe(ids.driver);
    expect(me.body.vehicles.map((v) => v.id)).toEqual([ids.car1]);

    const edited = await api.patch(C.me, { name: "Renamed Driver", phone: "9876543210" }, { token: tokens.driver });
    expect(edited.status).toBe(200);
    expect(edited.body.user).toEqual(expect.objectContaining({ name: "Renamed Driver", phone: "9876543210" }));

    const added = await api.post(C.myVehicles, { plateNumber: "KA01XY0001", vehicleType: "BIKE" }, { token: tokens.driver });
    expect(added.status).toBe(201);
    expect((await api.get(C.me, { token: tokens.driver })).body.vehicles).toHaveLength(2);

    // another driver's vehicle can't be removed
    expect((await api.delete(C.myVehicle(ids.car2), { token: tokens.driver })).status).toBe(404);
    expect((await api.delete(C.myVehicle(added.body.vehicle.id), { token: tokens.driver })).status).toBe(204);
  });

  test("API /api/users/me: requires a token", async () => {
    expect((await api.get(C.me)).status).toBe(401);
  });
});
