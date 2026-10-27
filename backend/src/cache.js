// Short-lived in-process cache for configuration the gates read on every vehicle (gates, facilities,
// zones), so an entry or exit doesn't pay a database round trip for data that rarely changes.
//
// Entries expire after CONFIG_CACHE_SECONDS (30 by default, 0 turns caching off). This process drops
// them at once when the admin console changes the configuration (configuration.js); other API
// instances pick the change up within the TTL. Values are shared, so callers must not modify them.
const Facility = require("./models/Facility");
const Gate = require("./models/Gate");
const Zone = require("./models/Zone");

const TTL_MS = (process.env.CONFIG_CACHE_SECONDS === undefined ? 30 : Number(process.env.CONFIG_CACHE_SECONDS)) * 1000;

const entries = new Map(); // key -> {value: Promise, expires}

// -> loader()'s result, loaded at most once per TTL per key. Concurrent callers share one load;
// a failed load or a null result isn't kept.
function cached(key, loader) {
  const hit = entries.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = Promise.resolve().then(loader);
  if (TTL_MS > 0) {
    entries.set(key, { value, expires: Date.now() + TTL_MS });
    const forget = () => { if (entries.get(key)?.value === value) entries.delete(key); };
    value.then((v) => { if (v == null) forget(); }, forget);
  }
  return value;
}

const clear = () => entries.clear();

// The configuration the gates read on every vehicle
const findGate = (id) => cached(`gate:${id}`, () => Gate.findById(id));
const findFacility = (id) => cached(`facility:${id}`, () => Facility.findById(id));
const findZone = (id) => cached(`zone:${id}`, () => Zone.findById(id));

module.exports = { cached, clear, findGate, findFacility, findZone };
