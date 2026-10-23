// Auth: password hashing, JWTs and login.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("./config");
const logger = require("./logger");
const User = require("./models/User");
const { unauthorized } = require("./errors");

const hashPassword = (password) => bcrypt.hash(password, config.bcryptRounds);

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", config.bcryptRounds);

const signToken = (user) =>
  jwt.sign({ role: user.role }, config.jwtSecret, { subject: user.id, expiresIn: config.jwtExpiresIn, algorithm: "HS256" });

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    throw unauthorized("Your session has expired or is invalid. Please log in again.");
  }
}

const INVALID_CREDENTIALS = "Incorrect email or password";

async function login({ email, password }) {
  const user = await User.findOne({ email });
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized(INVALID_CREDENTIALS);
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) throw unauthorized(INVALID_CREDENTIALS);

  logger.info("login", { userId: user.id, role: user.role });
  return { token: signToken(user), user: user.toPublic() };
}

module.exports = { hashPassword, signToken, verifyToken, login, comparePassword: bcrypt.compare };
