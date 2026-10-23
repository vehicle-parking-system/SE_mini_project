const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");
const { createApp } = require("./app");
const { ensureAdmin } = require("./accounts");

async function main() {
  const app = createApp(); // registers the models
  await mongoose.connect(config.mongoUrl);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const admin = await ensureAdmin({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME });
  if (admin) logger.info("admin account ready", { userId: admin.id });
  else if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) logger.warn("ADMIN_EMAIL belongs to a non-admin account; no admin was created");
  app.listen(config.port, () => logger.info("VPS API listening", { port: config.port, test: config.isTest }));
}

main().catch((err) => {
  logger.error("failed to start", { error: err.message });
  process.exit(1);
});
