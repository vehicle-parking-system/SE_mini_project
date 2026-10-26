// Facility-local dates and times. A facility's opening hours are in its own time zone,
// which may differ from the browser's, so search windows are built in that zone.

const pad = (n) => String(n).padStart(2, "0");

function parts(instant, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Offset of the zone from UTC at that instant, in minutes (e.g. +330 for India)
function offsetMinutes(instant, timeZone) {
  const { date, time } = parts(instant, timeZone);
  return Math.round((Date.parse(`${date}T${time}:00Z`) - instant.getTime()) / 60000);
}

// "2026-11-02", "14:00", "Asia/Kolkata" -> "2026-11-02T14:00:00+05:30"
export function zonedIso(date, time, timeZone) {
  const offset = offsetMinutes(new Date(`${date}T${time}:00Z`), timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Default window: from the next quarter hour, for two hours, in the facility's zone
export function defaultWindow(timeZone, now = new Date()) {
  const start = new Date(Math.ceil(now.getTime() / 900000) * 900000);
  const end = new Date(start.getTime() + 2 * 3600000);
  const s = parts(start, timeZone);
  const e = parts(end, timeZone);
  return { date: s.date, start: s.time, end: e.date === s.date ? e.time : "23:59" };
}

export const formatTime = (iso, timeZone) =>
  new Date(iso).toLocaleTimeString(undefined, { timeZone, hour: "2-digit", minute: "2-digit" });

export const formatDay = (iso, timeZone) =>
  new Date(iso).toLocaleDateString(undefined, { timeZone, weekday: "short", day: "numeric", month: "short" });
