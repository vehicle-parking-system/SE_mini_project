
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
  ["VPS-NF-001", "Response time <= 3 s (p90)", "TC-Perf-01"],
  ["VPS-NF-002", "99.5% availability", "Ops uptime reports"],
  ["VPS-NF-003", "Data protection", "TC-Sec-01"],
  ["VPS-NF-004", "Log retention >= 1 year", "TC-OPS-01"],
  ["VPS-NF-005", "10x scalability", "TC-Perf-02"],
  ["VPS-SR-001", "TLS 1.2+", "TC-Sec-02"],
  ["VPS-SR-002", "Password hashing", "TC-Sec-03"],
  ["VPS-SR-003", "RBAC", "TC-Sec-04"],
  ["VPS-SR-004", "Tokenized card data", "TC-Sec-05"],
  ["VPS-SR-005", "Account lockout", "TC-Sec-06"],
];

const ELSEWHERE = {
  "TC-Perf-01": "Nightly (JMeter)",
  "TC-Perf-02": "Nightly (JMeter)",
  "TC-Sec-02": "Nightly (testssl.sh)",
  "TC-OPS-01": "Manual",
  "Ops uptime reports": "Manual",
};

const results = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8")
);

const byCase = {};

for (const file of results.testResults || []) {
  for (const test of file.assertionResults || []) {
    const ids = test.title.match(/TC-[A-Za-z]+-\d+/g) || [];

    for (const id of ids) {
      (byCase[id] ??= []).push(test);
    }
  }
}

function status(tc) {
  const tests = byCase[tc];

  if (!tests || tests.length === 0) {
    return ELSEWHERE[tc] || "NO AUTOMATED TEST";
  }

  if (tests.some((test) => test.status === "failed")) {
    return "FAIL";
  }

  if (tests.some((test) => test.status === "pending")) {
    return "PARTIAL / NOT RUN";
  }

  if (tests.every((test) => test.status === "passed")) {
    return "PASS";
  }

  return "PARTIAL / NOT RUN";
}

const rows = RTM.map(([req, description, tc]) => {
  const count = byCase[tc]?.length ?? 0;

  return `| ${req} | ${description} | ${tc} | ${count} | ${status(tc)} |`;
});

const passed = results.numPassedTests ?? 0;
const failed = results.numFailedTests ?? 0;
const skipped = results.numPendingTests ?? 0;

const md = [
  "## Requirements Traceability Matrix",
  "",
  `Automated tests: **${passed} passed, ${failed} failed, ${skipped} not run**`,
  "",
  "| Requirement | Description | Test case | Tests | Status |",
  "|---|---|---|---:|---|",
  ...rows,
].join("\n");

console.log(md);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}

process.exit(failed > 0 ? 1 : 0);
