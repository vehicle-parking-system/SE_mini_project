// Notification Service (SMS / Email). No gateway is wired up yet: messages are
// recorded in an in-memory outbox (read by GET /api/test/notifications in test
// mode) and logged without the recipient's address.
const clock = require("./clock");
const logger = require("./logger");

const OUTBOX_LIMIT = 1000;
const outbox = [];

async function notify({ userId, to, channel = "EMAIL", type, data = {} }) {
  outbox.push({ to, channel, type, data, at: clock.now().toISOString() });
  if (outbox.length > OUTBOX_LIMIT) outbox.shift();
  logger.info("notification queued", { userId, channel, type });
}

const sent = () => [...outbox];
const clear = () => { outbox.length = 0; };

module.exports = { notify, sent, clear };
