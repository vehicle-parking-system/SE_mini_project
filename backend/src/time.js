// Local date and time of an instant in a given IANA time zone, e.g.
// localParts(new Date("2026-11-02T08:30:00Z"), "Asia/Kolkata") -> {date: "2026-11-02", time: "14:00"}
function localParts(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

module.exports = { localParts };
