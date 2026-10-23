// Server clock. Everything time-dependent calls now() so tests can move time
// with POST /api/test/clock (only exposed when NODE_ENV=test).
let offsetMs = 0;

const now = () => new Date(Date.now() + offsetMs);
const set = (date) => { offsetMs = new Date(date).getTime() - Date.now(); };
const reset = () => { offsetMs = 0; };

module.exports = { now, set, reset };
