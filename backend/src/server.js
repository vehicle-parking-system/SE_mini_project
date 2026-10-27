const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");
const { createApp } = require("./app");
const transport = require("./transport");
const { ensureAdmin } = require("./accounts");
const { expireHolds } = require("./reservations");

const SWEEP_MS = 60000;

async function main() {
  transport.enforceOutboundTls(); // before any connection is opened (VPS-SR-001)
  const app = createApp(); // registers the models
  await mongoose.connect(config.mongoUrl);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const admin = await ensureAdmin({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME });
  if (admin) logger.info("admin account ready", { userId: admin.id });
  else if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) logger.warn("ADMIN_EMAIL belongs to a non-admin account; no admin was created");
  // Lapsed holds are also expired whenever reservations are read; this keeps stored statuses current.
  setInterval(() => expireHolds().catch((err) => logger.error("hold sweep failed", { error: err.message })), SWEEP_MS).unref();
  await transport.listen(app, config);
}

main().catch((err) => {
  logger.error("failed to start", { error: err.message });
  process.exit(1);
});
