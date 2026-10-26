// GET /api/events?facilityId -> text/event-stream of live slot events (see events.js).
// Authenticated like every other endpoint (Authorization header), so clients read it with
// fetch() rather than EventSource, and no token ever goes into a URL.
const express = require("express");
const events = require("../events");

const router = express.Router();
const KEEPALIVE_MS = 25000;

router.get("/", (req, res) => {
  const facilityId = typeof req.query.facilityId === "string" ? req.query.facilityId : null;
  res.set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  res.flushHeaders();
  res.write(": connected\n\n");

  const unsubscribe = events.subscribe((event) => {
    if (!facilityId || event.facilityId === facilityId) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

module.exports = router;
