// Local date and time of an instant in a given IANA time zone, e.g.
// localParts(new Date("2026-11-02T08:30:00Z"), "Asia/Kolkata") -> {date: "2026-11-02", time: "14:00"}
function localParts(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Offset of the zone from UTC at an instant, in ms (e.g. +5:30 h for India)
function offsetMs(instant, timeZone) {
  const { date, time } = localParts(instant, timeZone);
  return Date.parse(`${date}T${time}:00Z`) - Math.floor(instant.getTime() / 60000) * 60000;
}

// The instant at a local date and time ("2026-11-02", "23:00") in a time zone. The offset is
// taken a second time at the result, in case a daylight-saving change lies in between.
function localInstant(date, time, timeZone) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

module.exports = { localParts, localInstant };
