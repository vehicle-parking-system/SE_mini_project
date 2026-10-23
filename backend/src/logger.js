// Minimal structured logger. VPS-NF-003: never pass request bodies, passwords,
// tokens or card data to it — callers log IDs and outcomes only.
// Quiet under Jest so test output stays readable.
const silent = Boolean(process.env.JEST_WORKER_ID);

function write(level, message, fields = {}) {
  if (silent) return;
  const line = JSON.stringify({ at: new Date().toISOString(), level, message, ...fields });
  (level === "error" ? console.error : console.log)(line);
}

module.exports = {
  info: (m, f) => write("info", m, f),
  warn: (m, f) => write("warn", m, f),
  error: (m, f) => write("error", m, f),
};
