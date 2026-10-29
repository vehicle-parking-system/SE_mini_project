// Acceptance suites for modules that haven't been built yet. They are skipped, so
// CI reports their test cases as "not run" in the RTM instead of failing every PR.
//
// When a module lands, delete its line here in the same PR: from then on its
// tests run and must pass. Set RUN_PENDING=1 to run them anyway while building one.
module.exports = [
  "api/admin.test.js", //       Lot / zone / slot config, rates, reports (TC-Admin-01–04)
];
