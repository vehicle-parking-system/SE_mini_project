// Hardware Abstraction Service (SAD §3.7): the one place that sends commands to gate
// barriers and displays. No gate controller is wired up yet, so commands go to a simulator
// that records them (read by GET /api/test/hardware/commands in test mode) and logs them.
const clock = require("./clock");
const logger = require("./logger");

const COMMAND_LIMIT = 1000;
const commands = [];

function send(gateId, command, message) {
  commands.push({ gateId: String(gateId), command, ...(message && { message }), at: clock.now().toISOString() });
  if (commands.length > COMMAND_LIMIT) commands.shift();
  logger.info("gate command", { gateId: String(gateId), command });
}

module.exports = {
  openBarrier: (gateId) => send(gateId, "OPEN"),
  display: (gateId, message) => send(gateId, "DISPLAY", message),
  sent: () => [...commands],
  clear: () => { commands.length = 0; },
};
