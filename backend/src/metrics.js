// Gate transaction timings (VPS-NF-001: an entry or exit completes within 3 s for 90% of vehicles).
// The API measures every POST /api/entry and /api/exit from request to response, keeps the latest
// WINDOW of each, and logs a warning for any that took longer than the budget. Admins read the
// percentiles from GET /api/admin/metrics/gates. Kept per API instance, in memory.
const logger = require("./logger");

const BUDGET_MS = 3000;
const TARGET_PCT = 90;
const WINDOW = 2000;
const samples = { entry: [], exit: [] };

function record(kind, ms) {
  const list = samples[kind];
  list.push(ms);
  if (list.length > WINDOW) list.shift();
  if (ms > BUDGET_MS) logger.warn("slow gate transaction", { kind, ms: Math.round(ms), budgetMs: BUDGET_MS });
}

// Express middleware timing one kind of transaction
const timeGate = (kind) => (_req, res, next) => {
  const started = process.hrtime.bigint();
  res.on("finish", () => record(kind, Number(process.hrtime.bigint() - started) / 1e6));
  next();
};

function percentile(sorted, q) {
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)]) : null;
}

function summary() {
  const of = (list) => {
    const sorted = [...list].sort((a, b) => a - b);
    const within = sorted.filter((ms) => ms <= BUDGET_MS).length;
    const withinBudgetPct = sorted.length ? Math.round((within / sorted.length) * 1000) / 10 : null;
    return { count: sorted.length, p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), p99: percentile(sorted, 0.99),
      max: sorted.length ? Math.round(sorted.at(-1)) : null, overBudget: sorted.length - within, withinBudgetPct,
      meetsTarget: withinBudgetPct === null ? null : withinBudgetPct >= TARGET_PCT };
  };
  return { budgetMs: BUDGET_MS, targetPct: TARGET_PCT, window: WINDOW, entry: of(samples.entry), exit: of(samples.exit) };
}

const clear = () => { samples.entry.length = 0; samples.exit.length = 0; };

module.exports = { timeGate, record, summary, clear, BUDGET_MS };
