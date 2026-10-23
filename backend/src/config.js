// All runtime settings come from the environment (see tests/README.md).
const isTest = process.env.NODE_ENV === "test";

const config = {
  isTest,
  port: Number(process.env.PORT) || 4000,
  mongoUrl: process.env.MONGO_URL || "mongodb://localhost:27017/vps",
  jwtSecret: process.env.JWT_SECRET || (isTest || process.env.NODE_ENV !== "production" ? "dev_jwt_secret" : undefined),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
};

if (!config.jwtSecret) throw new Error("JWT_SECRET must be set in production");

module.exports = config;
