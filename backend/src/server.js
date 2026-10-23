const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");
const { createApp } = require("./app");

async function main() {
  const app = createApp(); // registers the models
  await mongoose.connect(config.mongoUrl);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  app.listen(config.port, () => logger.info("VPS API listening", { port: config.port, test: config.isTest }));
}

main().catch((err) => {
  logger.error("failed to start", { error: err.message });
  process.exit(1);
});
