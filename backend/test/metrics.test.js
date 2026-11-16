// Gate transaction metrics (VPS-NF-001: 90% of entries/exits within 3 s). Admins read these numbers
// to judge the requirement, so the percentile, window and pass/fail logic are checked directly.
jest.mock("../src/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const logger = require("../src/logger");
const metrics = require("../src/metrics");

beforeEach(() => { metrics.clear(); logger.warn.mockClear(); });

test("with no samples every statistic is null, not zero", () => {
  expect(metrics.summary().entry).toEqual({ count: 0, p50: null, p90: null, p99: null, max: null, overBudget: 0,
    withinBudgetPct: null, meetsTarget: null });
});

test("percentiles use the nearest-rank method", () => {
  for (let ms = 1; ms <= 100; ms++) metrics.record("entry", ms);
  expect(metrics.summary().entry).toMatchObject({ count: 100, p50: 50, p90: 90, p99: 99, max: 100, overBudget: 0,
    withinBudgetPct: 100, meetsTarget: true });
  expect(metrics.summary().exit.count).toBe(0);
});

test("exactly 3000 ms is within budget; anything slower is over it and logged", () => {
  metrics.record("exit", metrics.BUDGET_MS);
  expect(logger.warn).not.toHaveBeenCalled();
  metrics.record("exit", metrics.BUDGET_MS + 0.6);
  expect(logger.warn).toHaveBeenCalledWith("slow gate transaction", { kind: "exit", ms: 3001, budgetMs: 3000 });
  expect(metrics.summary().exit).toMatchObject({ overBudget: 1, withinBudgetPct: 50, meetsTarget: false });
});

test("the target is met at exactly 90% within budget and missed below it", () => {
  for (let i = 0; i < 9; i++) metrics.record("entry", 100);
  metrics.record("entry", 5000);
  expect(metrics.summary().entry).toMatchObject({ withinBudgetPct: 90, meetsTarget: true });
  metrics.record("entry", 5000);
  expect(metrics.summary().entry).toMatchObject({ withinBudgetPct: 81.8, meetsTarget: false });
});

test("only the latest 2000 samples count", () => {
  metrics.record("entry", 9999);
  for (let i = 0; i < 2000; i++) metrics.record("entry", 10);
  expect(metrics.summary().entry).toMatchObject({ count: 2000, max: 10, overBudget: 0 });
});

test("the middleware times a request from start to finish", () => {
  const { EventEmitter } = require("events");
  const res = new EventEmitter();
  const next = jest.fn();
  metrics.timeGate("entry")({}, res, next);
  expect(next).toHaveBeenCalled();
  expect(metrics.summary().entry.count).toBe(0);
  res.emit("finish");
  expect(metrics.summary().entry.count).toBe(1);
});
