// Builds the Requirements Traceability Matrix (Test Plan §13) from Jest results.
// Usage: node rtm-report.js results/jest-results.json [perf-summary.json]
// Prints Markdown and, in GitHub Actions, writes it to the job summary.
// Exits 1 if any test case failed.
const fs = require("fs");

const RTM = [
  ["VPS-F-001", "Capture vehicle entry", "TC-Entry-01"],
  ["VPS-F-002", "Auto slot allocation", "TC-Entry-02"],
  ["VPS-F-003", "Facility Full rejection", "TC-Entry-03"],
  ["VPS-F-004", "Entry ticket", "TC-Entry-04"],
  ["VPS-F-010", "Fee calculation", "TC-Exit-01"],
  ["VPS-F-011", "Verify payment before exit", "TC-Exit-02"],
  ["VPS-F-012", "Slot release on exit", "TC-Exit-03"],
  ["VPS-F-013", "Receipt generation", "TC-Exit-04"],
  ["VPS-F-020", "Online slot reservation", "TC-Res-01"],
  ["VPS-F-021", "Slot search", "TC-Res-02"],
  ["VPS-F-022", "Grace-period hold", "TC-Res-03"],
  ["VPS-F-023", "Capacity / operating-hours rules", "TC-Res-04"],
  ["VPS-F-030", "Online and at-gate payment", "TC-Pay-01"],
  ["VPS-F-031", "Refunds", "TC-Pay-02"],
  ["VPS-F-032", "Transaction logging", "TC-Pay-03"],
  ["VPS-F-040", "Lot / zone / slot configuration", "TC-Admin-01"],
  ["VPS-F-041", "Pricing rules", "TC-Admin-02"],
  ["VPS-F-042", "Attendant accounts and manual override", "TC-Admin-03"],
  ["VPS-F-043", "Reports", "TC-Admin-04"],
  ["VPS-NF-001", "Response time ≤ 3 s (p90)", "TC-Perf-01"],
  ["VPS-NF-002", "99.5 % availability", "Ops uptime reports"],
  ["VPS-NF-003", "Data protection", "TC-Sec-01"],
  ["VPS-NF-004", "Log retention ≥ 1 year", "TC-OPS-01"],
  ["VPS-NF-005", "10× scalability", "TC-Perf-02"],
  ["VPS-SR-001", "TLS 1.2+", "TC-Sec-02"],
  ["VPS-SR-002", "Password hashing", "TC-Sec-03"],
  ["VPS-SR-003", "RBAC", "TC-Sec-04"],
  ["VPS-SR-004", "Tokenized card data", "TC-Sec-05"],
  ["VPS-SR-005", "Account lockout", "TC-Sec-06"],
];
// Checked outside this Jest run
const ELSEWHERE = {
  "TC-Perf-01": "Nightly (JMeter)", "TC-Perf-02": "Nightly (JMeter)", "TC-Sec-02": "Nightly (testssl.sh)",
  "TC-OPS-01": "Manual", "Ops uptime reports": "Manual",
};

const results = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const byCase = {};
for (const file of results.testResults) {
  for (const t of file.assertionResults) {
    for (const id of t.title.match(/TC-[A-Za-z]+-\d+/g) || []) (byCase[id] ??= []).push(t);
  }
}

function status(tc) {
  const tests = byCase[tc];
  if (!tests) return ELSEWHERE[tc] ?? "No automated test";
  if (tests.some((t) => t.status === "failed")) return "❌ A (failed)";
  if (tests.every((t) => t.status === "passed")) return "✅ P (passed)";
  return "⏸ N (not run)";
}

const rows = RTM.map(([req, name, tc]) => `| ${req} | ${name} | ${tc} | ${byCase[tc]?.length ?? 0} | ${status(tc)} |`);
const s = { passed: results.numPassedTests, failed: results.numFailedTests, skipped: results.numPendingTests };
const md = [
  "## Requirements Traceability Matrix",
  "",
  `Automated tests: **${s.passed} passed, ${s.failed} failed, ${s.skipped} not run**`,
  s.passed + s.failed === 0 ? "\n> ⚠️ No backend found: API tests were not run. They run automatically once `backend/` exists.\n" : "",
  "| Requirement | Description | Test case | Tests | Status |",
  "|---|---|---|---|---|",
  ...rows,
].join("\n");

console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
process.exit(s.failed > 0 ? 1 : 0);
