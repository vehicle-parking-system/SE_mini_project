// Reports (VPS-F-043). Admin only (see permissions.js).
const express = require("express");
const { buildReport, toCsv, csvFilename } = require("../reports");

const router = express.Router();

// GET /api/reports/:type?facilityId&from&to&format=json|csv   type: occupancy|revenue|usage
// from/to are the facility's local dates (YYYY-MM-DD, inclusive, default today, at most 366 days).
// json -> {type, facility, from, to, generatedAt, totals, days:[{date, ...}]} (revenue also has `total`, the net)
// csv  -> one row per day and a TOTAL row, as an attachment
router.get("/:type", async (req, res) => {
  const { format, report } = await buildReport(req.params.type, req.query);
  if (format === "csv") {
    res.set({ "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${csvFilename(report)}"` });
    return res.send(toCsv(report));
  }
  res.json(report);
});

module.exports = router;
