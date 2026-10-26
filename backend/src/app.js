const express = require("express");
const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");
const { ApiError } = require("./errors");
const { authorize } = require("./middleware/auth");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(express.json({ limit: "100kb" }));

  // Access log: method, path and status only — never bodies, query strings or headers (VPS-NF-003).
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => logger.info("request", {
      method: req.method, path: req.originalUrl.split("?")[0], status: res.statusCode, ms: Date.now() - started,
    }));
    next();
  });

  // Every /api request passes the RBAC policy before reaching a route.
  app.use("/api", authorize);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", db: mongoose.connection.readyState === 1 ? "up" : "down" });
  });

  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/users", require("./routes/users"));
  app.use("/api/facilities", require("./routes/facilities"));
  app.use("/api/slots", require("./routes/slots"));
  app.use("/api/reservations", require("./routes/reservations"));
  app.use("/api/admin", require("./routes/admin"));
  if (config.isTest) app.use("/api/test", require("./routes/test"));

  app.use("/api", (_req, _res, next) => next(new ApiError(404, "NOT_FOUND", "No such endpoint")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ApiError) {
      if (err.headers) res.set(err.headers);
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request body is not valid JSON" } });
    }
    if (err instanceof mongoose.Error.CastError) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    }
    logger.error("unhandled error", { method: req.method, path: req.originalUrl.split("?")[0], error: err.message });
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
  });

  return app;
}

module.exports = { createApp };
