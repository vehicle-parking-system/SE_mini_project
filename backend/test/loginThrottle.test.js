// Per-IP login throttle (VPS-SR-005, credential stuffing). The database calls are stubbed so the
// race and error branches that a live MongoDB rarely produces can be driven directly.
const config = require("../src/config");
const LoginThrottle = require("../src/models/LoginThrottle");
const { reserveAttempt, refundAttempt } = require("../src/loginThrottle");

const NOW = new Date("2026-11-13T10:07:30Z");
const windowMs = config.loginIpWindowMinutes * 60000;
const KEY = `203.0.113.7|${Math.floor(NOW.getTime() / windowMs)}`;
const duplicate = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

afterEach(() => jest.restoreAllMocks());

test("a request without a client IP is not throttled and touches nothing", async () => {
  const find = jest.spyOn(LoginThrottle, "findOneAndUpdate");
  await expect(reserveAttempt(undefined, NOW, jest.fn())).resolves.toBeNull();
  expect(find).not.toHaveBeenCalled();
});

test("an attempt reserves a slot in the IP's current window", async () => {
  const find = jest.spyOn(LoginThrottle, "findOneAndUpdate").mockResolvedValue({});
  await expect(reserveAttempt("203.0.113.7", NOW, jest.fn())).resolves.toBe(KEY);
  const [filter, update, options] = find.mock.calls[0];
  expect(filter).toEqual({ _id: KEY, count: { $lt: config.loginIpMaxFailures } });
  expect(update.$inc).toEqual({ count: 1 });
  expect(options).toEqual({ upsert: true });
});

test("losing a race to create the window document retries once and succeeds", async () => {
  jest.spyOn(LoginThrottle, "findOneAndUpdate").mockRejectedValueOnce(duplicate()).mockResolvedValueOnce({});
  await expect(reserveAttempt("203.0.113.7", NOW, jest.fn())).resolves.toBe(KEY);
});

test("a full window refuses with 429 and Retry-After, alerting admins only the first time", async () => {
  jest.spyOn(LoginThrottle, "findOneAndUpdate").mockRejectedValue(duplicate());
  const update = jest.spyOn(LoginThrottle, "updateOne")
    .mockResolvedValueOnce({ modifiedCount: 1 }).mockResolvedValueOnce({ modifiedCount: 0 });
  const onLimited = jest.fn();

  for (let i = 0; i < 2; i++) {
    const err = await reserveAttempt("203.0.113.7", NOW, onLimited).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.code).toBe("TOO_MANY_REQUESTS");
    const retryAfter = Number(err.headers["Retry-After"]);
    const windowEnd = (Math.floor(NOW.getTime() / windowMs) + 1) * windowMs;
    expect(retryAfter).toBe(Math.ceil((windowEnd - NOW.getTime()) / 1000));
  }
  expect(onLimited).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][0]).toEqual({ _id: KEY, alerted: { $ne: true } });
});

test("database errors other than a duplicate key are not swallowed", async () => {
  jest.spyOn(LoginThrottle, "findOneAndUpdate").mockRejectedValue(new Error("connection reset"));
  await expect(reserveAttempt("203.0.113.7", NOW, jest.fn())).rejects.toThrow("connection reset");
});

test("a successful login gives its slot back, never below zero", async () => {
  const update = jest.spyOn(LoginThrottle, "updateOne").mockResolvedValue({});
  await refundAttempt(null);
  expect(update).not.toHaveBeenCalled();
  await refundAttempt(KEY);
  expect(update).toHaveBeenCalledWith({ _id: KEY, count: { $gt: 0 } }, { $inc: { count: -1 } });
});
