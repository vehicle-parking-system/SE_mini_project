const { PUBLIC, findRule } = require("../src/permissions");

const roles = (method, path) => findRule(method, path)?.roles ?? null;

describe("RBAC policy", () => {
  test.each([
    ["GET", "/api/health"], ["POST", "/api/auth/register"], ["POST", "/api/auth/login"],
    ["POST", "/api/payments/webhook"], ["POST", "/api/test/reset"],
  ])("%s %s is public", (method, path) => {
    expect(roles(method, path)).toBe(PUBLIC);
  });

  // [method, path, roles allowed] — mirrors the TC-Sec-04 matrix plus the account endpoints
  test.each([
    ["GET", "/api/users/me", ["DRIVER", "ATTENDANT", "ADMIN"]],
    ["POST", "/api/users/me/password", ["DRIVER", "ATTENDANT", "ADMIN"]],
    ["POST", "/api/users/me/vehicles", ["DRIVER"]],
    ["DELETE", "/api/users/me/vehicles/abc123", ["DRIVER"]],
    ["GET", "/api/slots/available", ["DRIVER"]],
    ["POST", "/api/reservations", ["DRIVER"]],
    ["GET", "/api/reservations", ["DRIVER"]],
    ["GET", "/api/reservations/r1", ["DRIVER", "ADMIN"]],
    ["POST", "/api/reservations/r1/cancel", ["DRIVER", "ADMIN"]],
    ["POST", "/api/entry", ["ATTENDANT", "ADMIN"]],
    ["POST", "/api/exit", ["ATTENDANT", "ADMIN"]],
    ["GET", "/api/sessions", ["ATTENDANT", "ADMIN"]],
    ["GET", "/api/sessions/s1", ["ATTENDANT", "ADMIN"]],
    ["GET", "/api/slots/s1", ["ATTENDANT", "ADMIN"]],
    ["GET", "/api/occupancy/f1", ["ATTENDANT", "ADMIN"]],
    ["GET", "/api/gates/status", ["ATTENDANT", "ADMIN"]],
    ["GET", "/api/gates/overrides", ["ATTENDANT", "ADMIN"]],
    ["POST", "/api/gates/g1/override", ["ATTENDANT", "ADMIN"]],
    ["POST", "/api/payments", ["DRIVER", "ATTENDANT"]],
    ["GET", "/api/admin/transactions", ["ADMIN"]],
    ["GET", "/api/admin/audit-logs", ["ADMIN"]],
    ["PUT", "/api/admin/rates", ["ADMIN"]],
    ["POST", "/api/admin/attendants", ["ADMIN"]],
    ["GET", "/api/reports/revenue", ["ADMIN"]],
  ])("%s %s -> %j", (method, path, allowed) => {
    expect(roles(method, path)).toEqual(allowed);
  });

  test("HEAD is treated like GET", () => {
    expect(roles("HEAD", "/api/users/me")).toEqual(roles("GET", "/api/users/me"));
  });

  test("anything not in the policy is denied (no rule)", () => {
    expect(findRule("GET", "/api/unknown")).toBeNull();
    expect(findRule("DELETE", "/api/reservations")).toBeNull(); // wrong method
    expect(findRule("GET", "/api/users/me-other")).toBeNull(); // only /me and /me/...
    expect(findRule("GET", "/api/reports/a/b")).toBeNull(); //   ":type" is one segment
    expect(findRule("GET", "/api/healthz")).toBeNull();
  });

  test("the more specific rule wins: /slots/available is not treated as /slots/:id", () => {
    expect(roles("GET", "/api/slots/available")).toEqual(["DRIVER"]);
  });
});
