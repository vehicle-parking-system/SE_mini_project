// Gate configuration cache (src/cache.js). A stale or poisoned entry would let a gate act on
// configuration an admin already changed, so failure and expiry paths are checked. No database needed.
const cache = require("../src/cache");
const Gate = require("../src/models/Gate");

afterEach(() => { cache.clear(); jest.restoreAllMocks(); });

test("concurrent callers share a single load", async () => {
  const loader = jest.fn(async () => ({ id: 1 }));
  const [a, b] = await Promise.all([cache.cached("k", loader), cache.cached("k", loader)]);
  expect(a).toBe(b);
  expect(loader).toHaveBeenCalledTimes(1);
});

test("a null result is not kept, so a record created later is found", async () => {
  const loader = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 2 });
  expect(await cache.cached("k", loader)).toBeNull();
  expect(await cache.cached("k", loader)).toEqual({ id: 2 });
  expect(loader).toHaveBeenCalledTimes(2);
});

test("a failed load is not kept", async () => {
  const loader = jest.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ id: 3 });
  await expect(cache.cached("k", loader)).rejects.toThrow("db down");
  expect(await cache.cached("k", loader)).toEqual({ id: 3 });
});

test("entries expire after the TTL", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  const loader = jest.fn(async () => ({ v: Date.now() }));
  await cache.cached("k", loader);
  now.mockReturnValue(1_000_000 + 29_999);
  await cache.cached("k", loader);
  expect(loader).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1_000_000 + 30_001);
  await cache.cached("k", loader);
  expect(loader).toHaveBeenCalledTimes(2);
});

test("clear() drops everything, as the admin console does after a change", async () => {
  const loader = jest.fn(async () => ({}));
  await cache.cached("k", loader);
  cache.clear();
  await cache.cached("k", loader);
  expect(loader).toHaveBeenCalledTimes(2);
});

test("findGate reads through the cache by id", async () => {
  const findById = jest.spyOn(Gate, "findById").mockResolvedValue({ _id: "g1" });
  await cache.findGate("g1");
  await cache.findGate("g1");
  await cache.findGate("g2");
  expect(findById.mock.calls).toEqual([["g1"], ["g2"]]);
});

test("CONFIG_CACHE_SECONDS=0 turns caching off", async () => {
  const before = process.env.CONFIG_CACHE_SECONDS;
  process.env.CONFIG_CACHE_SECONDS = "0";
  let uncached;
  jest.isolateModules(() => { uncached = require("../src/cache"); });
  if (before === undefined) delete process.env.CONFIG_CACHE_SECONDS; else process.env.CONFIG_CACHE_SECONDS = before;
  const loader = jest.fn(async () => ({}));
  await uncached.cached("k", loader);
  await uncached.cached("k", loader);
  expect(loader).toHaveBeenCalledTimes(2);
});
