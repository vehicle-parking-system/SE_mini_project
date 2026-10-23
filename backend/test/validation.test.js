const { validateRegistration, validateLogin, validateProfileUpdate, validateVehicle } = require("../src/validation");

const valid = {
  name: " Asha Rao ", email: " Asha@Example.COM ", phone: "+91 98765-43210", password: "Secret123",
  vehicles: [{ plateNumber: "ka 01-ab 1234", vehicleType: "CAR" }],
};

const errorsOf = (fn) => {
  try { fn(); } catch (err) { return err.details; }
  throw new Error("expected validation to fail");
};

describe("validateRegistration", () => {
  test("normalizes name, email, phone and plate numbers", () => {
    expect(validateRegistration(valid)).toEqual({
      name: "Asha Rao", email: "asha@example.com", phone: "9876543210", password: "Secret123",
      vehicles: [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }],
    });
  });

  test("vehicles are optional", () => {
    expect(validateRegistration({ ...valid, vehicles: undefined }).vehicles).toEqual([]);
  });

  test("reports every invalid field at once", () => {
    const errors = errorsOf(() => validateRegistration({ name: "A", email: "nope", phone: "12345", password: "short",
      vehicles: [{ plateNumber: "!", vehicleType: "PLANE" }] }));
    expect(Object.keys(errors).sort()).toEqual(
      ["email", "name", "password", "phone", "vehicles[0].plateNumber", "vehicles[0].vehicleType"]);
  });

  test.each(["password", "12345678", "abcdefgh"])("rejects weak password %s", (password) => {
    expect(errorsOf(() => validateRegistration({ ...valid, password }))).toHaveProperty("password");
  });

  test("rejects the same plate twice", () => {
    const vehicles = [{ plateNumber: "KA01AB1234", vehicleType: "CAR" }, { plateNumber: "ka01ab1234", vehicleType: "BIKE" }];
    expect(errorsOf(() => validateRegistration({ ...valid, vehicles }))).toHaveProperty("vehicles");
  });
});

test("validateLogin requires email and password", () => {
  expect(Object.keys(errorsOf(() => validateLogin({})))).toEqual(["email", "password"]);
  expect(validateLogin({ email: "A@B.co ", password: "x" })).toEqual({ email: "a@b.co", password: "x" });
});

test("validateProfileUpdate changes only the given fields and rejects an empty update", () => {
  expect(validateProfileUpdate({ phone: "09876543210" })).toEqual({ phone: "9876543210" });
  expect(errorsOf(() => validateProfileUpdate({}))).toHaveProperty("body");
  expect(errorsOf(() => validateProfileUpdate({ email: "x@y.z" }))).toHaveProperty("body");
});

test("validateVehicle", () => {
  expect(validateVehicle({ plateNumber: "mh12 de 1433", vehicleType: "BIKE" }))
    .toEqual({ plateNumber: "MH12DE1433", vehicleType: "BIKE" });
  expect(errorsOf(() => validateVehicle({}))).toHaveProperty(["vehicle.plateNumber"]);
});
