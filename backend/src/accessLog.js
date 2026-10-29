// Access log writer (VPS-NF-004). Every API request is recorded as an AccessLog entry. Entries are
// buffered and written in batches about once a second, so logging never adds a database round trip
// to a request (VPS-NF-001). If the database is unreachable, up to MAX_BUFFER entries wait; beyond
// that the oldest are dropped and the loss is logged.
const mongoose = require("mongoose");
const logger = require("./logger");
const AccessLog = require("./models/AccessLog");

const FLUSH_MS = 1000;
const MAX_BATCH = 500;
const MAX_BUFFER = 10000;

const buffer = [];
let timer = null;
let dropped = 0;

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, FLUSH_MS);
  timer.unref?.();
}

// entry: {at, method, path, status, ms, userId?, role?, ip?}
function record(entry) {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) {
    buffer.shift();
    dropped += 1;
  }
  if (buffer.length >= MAX_BATCH) flush().catch(() => {});
  else schedule();
}

// Writes everything buffered so far (in batches); resolves once it is stored.
async function flush() {
  if (dropped) {
    logger.error("access log entries dropped", { count: dropped });
    dropped = 0;
  }
  if (mongoose.connection.readyState !== 1) {
    if (buffer.length) schedule();
    return;
  }
  while (buffer.length) {
    const batch = buffer.splice(0, MAX_BATCH);
    try {
      await AccessLog.insertMany(batch, { ordered: false, lean: true });
    } catch (err) {
      logger.error("access log write failed", { count: batch.length, error: err.message });
      return;
    }
  }
}

const pending = () => buffer.length;
const clear = () => { buffer.length = 0; };

module.exports = { record, flush, pending, clear };
