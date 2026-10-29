// Hardware Abstraction Service (SAD §3.7): the one place that sends commands to gate
// barriers and displays. No gate controller is wired up yet, so commands go to a simulator
// that records them (read by GET /api/test/hardware/commands in test mode) and logs them.
//
// Network loss to a gate controller (SAD §3.7 risk): a command that can't be delivered is
// queued for that gate, in order, and retried with exponential backoff until the link is back.
// Each command is delivered exactly once. A queued command that hasn't gone through within
// HARDWARE_QUEUE_TTL_SECONDS is dropped, so a barrier never opens long after the vehicle (or the
// attendant who pressed the button) has gone; attendants then use a manual override.
const clock = require("./clock");
const logger = require("./logger");

const COMMAND_LIMIT = 1000;
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 2000;
const QUEUE_TTL_MS = (Number(process.env.HARDWARE_QUEUE_TTL_SECONDS) || 120) * 1000;

const commands = []; // delivered, oldest first
const gates = new Map(); // gateId -> {up, reachable, queue:[{command, message, queuedAt}], timer, retryMs, lastDeliveredAt}

function gateState(gateId) {
  let state = gates.get(gateId);
  if (!state) {
    // up: the simulated link; reachable: whether the last delivery attempt got through
    state = { up: true, reachable: true, queue: [], timer: null, retryMs: RETRY_FIRST_MS, lastDeliveredAt: null };
    gates.set(gateId, state);
  }
  return state;
}

// The gate controller link. The simulator fails while its link is down (POST /api/test/hardware/link).
function deliver(gateId, state, { command, message }) {
  state.reachable = state.up;
  if (!state.up) throw new Error("gate controller unreachable");
  const at = clock.now().toISOString();
  commands.push({ gateId, command, ...(message && { message }), at });
  if (commands.length > COMMAND_LIMIT) commands.shift();
  state.lastDeliveredAt = at;
  logger.info("gate command", { gateId, command });
}

// Delivers queued commands in order; stops at the first failure and tries again later.
function flush(gateId) {
  const state = gateState(gateId);
  state.timer = null;
  while (state.queue.length) {
    const next = state.queue[0];
    if (Date.now() - next.queuedAt > QUEUE_TTL_MS) {
      state.queue.shift();
      logger.warn("gate command expired undelivered", { gateId, command: next.command });
      continue;
    }
    try {
      deliver(gateId, state, next);
    } catch {
      state.timer = setTimeout(() => flush(gateId), state.retryMs);
      state.timer.unref?.();
      state.retryMs = Math.min(state.retryMs * 2, RETRY_MAX_MS);
      return;
    }
    state.queue.shift();
  }
  state.retryMs = RETRY_FIRST_MS;
}

// -> true if delivered now, false if queued for retry
function send(gateId, command, message) {
  const id = String(gateId);
  const state = gateState(id);
  const cmd = { command, message, queuedAt: Date.now() };
  if (!state.queue.length) {
    try {
      deliver(id, state, cmd);
      return true;
    } catch {
      logger.warn("gate controller unreachable: command queued", { gateId: id, command });
    }
  }
  state.queue.push(cmd); // behind earlier commands, so the gate sees them in order
  if (!state.timer) {
    state.timer = setTimeout(() => flush(id), state.retryMs);
    state.timer.unref?.();
  }
  return false;
}

// What the service knows about each gate's link: {gateId: {online, queued, lastDeliveredAt}}.
// online is the outcome of the last delivery attempt; a gate never talked to counts as online.
function status(gateIds) {
  return Object.fromEntries(gateIds.map(String).map((id) => {
    const state = gates.get(id);
    return [id, { online: state?.reachable ?? true, queued: state?.queue.length ?? 0,
      lastDeliveredAt: state?.lastDeliveredAt ?? null }];
  }));
}

// Simulator only: take a gate's network link down or bring it back
function setLink(gateId, up) {
  gateState(String(gateId)).up = Boolean(up);
}

function clear() {
  commands.length = 0;
  for (const state of gates.values()) clearTimeout(state.timer);
  gates.clear();
}

module.exports = {
  openBarrier: (gateId) => send(gateId, "OPEN"),
  closeBarrier: (gateId) => send(gateId, "CLOSE"),
  display: (gateId, message) => send(gateId, "DISPLAY", message),
  status,
  setLink,
  sent: () => [...commands],
  clear,
};
