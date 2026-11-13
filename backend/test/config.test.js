// Startup guards in src/config.js (VPS-SR-001 TLS, VPS-NF-004 retention, production secrets).
// The API must refuse to start with an unsafe configuration rather than run insecurely, so each
// guard is checked on its own. No HTTP server or database required.
const ORIGINAL_ENV = { ...process.env };
const KEYS = ["NODE_ENV", "JWT_SECRET", "PAYMENT_WEBHOOK_SECRET", "MONGO_URL", "TLS_CERT_FILE", "TLS_KEY_FILE",
  "TLS_TERMINATED_BY_PROXY", "TRUST_PROXY", "LOG_RETENTION_DAYS", "LOG_HOT_DAYS", "LOCK_SCHEDULE_MINUTES", "QR_SECRET",
  "HTTP_REDIRECT_PORT", "PAYMENT_SANDBOX_AUTOCONFIRM"];

// A production environment that passes every guard; each test breaks one thing.
const SAFE_PRODUCTION = {
  NODE_ENV: "production", JWT_SECRET: "prod-jwt", PAYMENT_WEBHOOK_SECRET: "prod-webhook",
  MONGO_URL: "mongodb+srv://db.example.com/vps", TLS_TERMINATED_BY_PROXY: "true", TRUST_PROXY: "1",
};

function load(env) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let config;
  jest.isolateModules(() => { config = require("../src/config"); });
  return config;
}

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  for (const k of KEYS) if (ORIGINAL_ENV[k] !== undefined) process.env[k] = ORIGINAL_ENV[k];
});

describe("production startup guards", () => {
  test("a fully configured production environment starts", () => {
    const config = load(SAFE_PRODUCTION);
    expect(config.isProduction).toBe(true);
    expect(config.https.enforce).toBe(true);
    expect(config.trustProxy).toBe(1);
    expect(config.paymentSandboxAutoConfirm).toBe(true);
  });

  test.each([
    ["JWT_SECRET is missing", { JWT_SECRET: undefined }, /JWT_SECRET must be set/],
    ["PAYMENT_WEBHOOK_SECRET is missing", { PAYMENT_WEBHOOK_SECRET: undefined }, /PAYMENT_WEBHOOK_SECRET must be set/],
    ["TLS is not configured", { TLS_TERMINATED_BY_PROXY: undefined }, /TLS is required in production/],
    ["MongoDB is remote without TLS", { MONGO_URL: "mongodb://db.example.com:27017/vps" }, /remote host without TLS/],
    ["MongoDB TLS is switched off", { MONGO_URL: "mongodb+srv://db.example.com/vps?tls=false" }, /turns TLS off/],
    ["MONGO_URL is not a MongoDB URL", { MONGO_URL: "postgres://db/vps" }, /not a valid MongoDB connection string/],
  ])("refuses to start when %s", (_name, change, message) => {
    const env = { ...SAFE_PRODUCTION, ...change };
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete env[k];
    expect(() => load(env)).toThrow(message);
  });
});

describe("guards in every environment", () => {
  test("logs must be retained for at least a year", () => {
    expect(() => load({ LOG_RETENTION_DAYS: "364" })).toThrow(/at least 365/);
    expect(load({ LOG_RETENTION_DAYS: "365", LOG_HOT_DAYS: "30" }).logRetentionDays).toBe(365);
  });

  test("logs must leave the database before they expire", () => {
    expect(() => load({ LOG_RETENTION_DAYS: "400", LOG_HOT_DAYS: "400" })).toThrow(/LOG_HOT_DAYS must be less/);
  });

  test("a TLS certificate needs its key and vice versa", () => {
    expect(() => load({ TLS_CERT_FILE: "cert.pem" })).toThrow(/both TLS_CERT_FILE and TLS_KEY_FILE/);
    expect(() => load({ TLS_KEY_FILE: "key.pem" })).toThrow(/both TLS_CERT_FILE and TLS_KEY_FILE/);
    expect(load({ TLS_CERT_FILE: "cert.pem", TLS_KEY_FILE: "key.pem" }).https.enforce).toBe(true);
  });

  test("TLS at a proxy needs TRUST_PROXY so HTTPS requests can be told apart", () => {
    expect(() => load({ TLS_TERMINATED_BY_PROXY: "true" })).toThrow(/needs TRUST_PROXY/);
  });
});

describe("parsed settings", () => {
  test.each([[undefined, false], ["false", false], ["true", true], ["2", 2], ["10.0.0.1, 10.0.0.2", "10.0.0.1, 10.0.0.2"]])(
    "TRUST_PROXY=%p is read as %p", (value, expected) => {
      expect(load(value === undefined ? {} : { TRUST_PROXY: value }).trustProxy).toEqual(expected);
    });

  test("the lock schedule falls back to the default when invalid", () => {
    expect(load({ LOCK_SCHEDULE_MINUTES: "5, 30" }).lockScheduleMinutes).toEqual([5, 30]);
    expect(load({ LOCK_SCHEDULE_MINUTES: "5,abc" }).lockScheduleMinutes).toEqual([15, 60, 1440]);
    expect(load({ LOCK_SCHEDULE_MINUTES: "0,10" }).lockScheduleMinutes).toEqual([15, 60, 1440]);
  });

  test("the QR signing secret is derived from JWT_SECRET unless set", () => {
    const a = load({ JWT_SECRET: "one" }).qrSecret;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(load({ JWT_SECRET: "two" }).qrSecret).not.toBe(a);
    expect(load({ JWT_SECRET: "one", QR_SECRET: "explicit" }).qrSecret).toBe("explicit");
  });

  test("an HTTP redirect port is read as a number", () => {
    expect(load({ HTTP_REDIRECT_PORT: "8080" }).https.redirectPort).toBe(8080);
    expect(load({}).https.redirectPort).toBeNull();
  });
});
