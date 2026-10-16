// Checks a JMeter results file (CSV .jtl) against the SRS targets.
// Usage: node check-results.js results.jtl perf01|perf02
//   perf01 — TC-Perf-01 / VPS-NF-001: 90th percentile of Entry and Exit <= 3000 ms
//   perf02 — TC-Perf-02 / VPS-NF-005: at 10x baseline load, zero failed requests
const fs = require("fs");

const [file, mode] = process.argv.slice(2);
const [header, ...lines] = fs.readFileSync(file, "utf8").trim().split("\n");
const col = Object.fromEntries(header.split(",").map((h, i) => [h, i]));
const samples = lines.map((l) => l.split(",")).map((c) => ({
  label: c[col.label], elapsed: Number(c[col.elapsed]), success: c[col.success] === "true",
}));

const p90 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.9) - 1];
};

const out = [];
let ok = true;
if (mode === "perf01") {
  // failed requests are fast but meaningless, so any failure fails the check
  out.push("### TC-Perf-01 (VPS-NF-001): p90 ≤ 3000 ms", "", "| Transaction | Samples | Failed | p90 (ms) | Result |", "|---|---|---|---|---|");
  for (const label of ["Entry", "Exit"]) {
    const ofLabel = samples.filter((s) => s.label === label);
    const failed = ofLabel.filter((s) => !s.success).length;
    const v = ofLabel.length ? p90(ofLabel.map((s) => s.elapsed)) : NaN;
    const pass = ofLabel.length > 0 && failed === 0 && v <= 3000;
    ok &&= pass;
    out.push(`| ${label} | ${ofLabel.length} | ${failed} | ${v} | ${pass ? "✅" : "❌"} |`);
  }
} else if (mode === "perf02") {
  const failed = samples.filter((s) => !s.success);
  ok = samples.length > 0 && failed.length === 0;
  out.push("### TC-Perf-02 (VPS-NF-005): 10× baseline", "",
    `${samples.length} requests, ${failed.length} failed — ${ok ? "✅ passed" : "❌ failed"}`);
} else {
  console.error("mode must be perf01 or perf02");
  process.exit(2);
}

const md = out.join("\n");
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n\n");
process.exit(ok ? 0 : 1);
