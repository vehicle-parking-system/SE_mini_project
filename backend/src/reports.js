// Occupancy, revenue and usage reports (VPS-F-043), one row per day of a facility, as JSON or CSV.
//
// - Days are the facility's local calendar days (its time zone), from `from` to `to` inclusive
//   (default: today), at most MAX_DAYS of them.
// - Revenue counts money when it moved: a payment on the day the gateway confirmed it, a refund
//   on the day it was processed. Net = payments − refunds.
// - Occupancy is measured over each day's opening hours against the slots in use now (inactive
//   slots excluded): the average share of slots occupied, the peak number of vehicles parked at
//   once, and turnover (vehicles that entered per slot).
// - Usage: how vehicles came in (ANPR, QR, manual), walk-ins vs bookings, vehicle types, stays,
//   and what became of the day's bookings.
const clock = require("./clock");
const Facility = require("./models/Facility");
const Payment = require("./models/Payment");
const Reservation = require("./models/Reservation");
const Session = require("./models/Session");
const Slot = require("./models/Slot");
const { isId } = require("./slotSearch");
const { localParts, localInstant } = require("./time");
const { VEHICLE_TYPES } = require("./validation");
const { badRequest, notFound } = require("./errors");

const REPORT_TYPES = ["occupancy", "revenue", "usage"];
const FORMATS = ["json", "csv"];
const MAX_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "2026-11-02", 1 -> "2026-11-03"
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const validDate = (v) => typeof v === "string" && DATE_RE.test(v) && addDays(v, 0) === v;
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const overlap = (aStart, aEnd, bStart, bEnd) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

async function parseQuery(type, query = {}) {
  if (!REPORT_TYPES.includes(type)) throw notFound(`No such report. Use one of ${REPORT_TYPES.join(", ")}`);
  const errors = {};
  if (!isId(query.facilityId)) errors.facilityId = "Choose a facility";
  for (const f of ["from", "to"]) if (query[f] !== undefined && !validDate(query[f])) errors[f] = "Use a date like 2026-11-02";
  if (query.format !== undefined && !FORMATS.includes(query.format)) errors.format = "Format must be json or csv";
  if (Object.keys(errors).length) throw badRequest("Some report fields are invalid", errors);

  const facility = await Facility.findById(query.facilityId);
  if (!facility) throw notFound("Facility not found");
  const today = localParts(clock.now(), facility.timezone).date;
  const from = query.from ?? query.to ?? today;
  const to = query.to ?? (query.from ? today : from);
  const days = [];
  for (let d = from; d <= to && days.length <= MAX_DAYS; d = addDays(d, 1)) days.push(d);
  if (from > to) throw badRequest("Some report fields are invalid", { to: "The end date must not be before the start date" });
  if (days.length > MAX_DAYS) throw badRequest("Some report fields are invalid", { to: `A report covers at most ${MAX_DAYS} days` });

  const tz = facility.timezone;
  const windows = days.map((date) => ({
    date, start: localInstant(date, "00:00", tz).getTime(), end: localInstant(addDays(date, 1), "00:00", tz).getTime(),
    open: localInstant(date, facility.openTime, tz).getTime(), close: localInstant(date, facility.closeTime, tz).getTime(),
  }));
  return { facility, from, to, windows, format: query.format ?? "json",
    range: { $gte: new Date(windows[0].start), $lt: new Date(windows.at(-1).end) } };
}

// The day an instant falls on, or undefined if outside the report
const dayOf = (windows, instant) => windows.find((w) => instant >= w.start && instant < w.end);

async function revenueReport({ facility, windows, range }) {
  const transactions = await Payment.find({ facility: facility._id, confirmedAt: range,
    $or: [{ type: "PAYMENT", status: "CONFIRMED" }, { type: "REFUND", status: "PROCESSED" }] },
  "type method amount confirmedAt session reservation").lean();
  const empty = () => ({ payments: 0, gross: 0, refunds: 0, refunded: 0, net: 0, atGate: 0, online: 0, parking: 0, bookings: 0 });
  const rows = Object.fromEntries(windows.map((w) => [w.date, { date: w.date, ...empty() }]));
  const totals = empty();
  for (const t of transactions) {
    const day = dayOf(windows, t.confirmedAt.getTime());
    if (!day) continue;
    for (const r of [rows[day.date], totals]) {
      if (t.type === "REFUND") {
        r.refunds += 1;
        r.refunded += t.amount;
        r.net -= t.amount;
      } else {
        r.payments += 1;
        r.gross += t.amount;
        r.net += t.amount;
        r[t.method === "AT_GATE" ? "atGate" : "online"] += t.amount;
        r[t.reservation && !t.session ? "bookings" : "parking"] += t.amount;
      }
    }
  }
  const days = Object.values(rows).map((r) => ({ ...r, gross: round(r.gross), refunded: round(r.refunded), net: round(r.net) }));
  return { total: round(totals.net), totals: { ...totals, gross: round(totals.gross), refunded: round(totals.refunded), net: round(totals.net) },
    days };
}

async function sessionsIn(facility, windows, fields) {
  const start = new Date(windows[0].start);
  const end = new Date(windows.at(-1).end);
  return Session.find({ facility: facility._id, entryTime: { $lt: end }, $or: [{ exitTime: null }, { exitTime: { $gt: start } }] },
    fields).lean();
}

async function occupancyReport({ facility, windows }) {
  const now = clock.now().getTime();
  const [capacity, sessions] = await Promise.all([
    Slot.countDocuments({ facility: facility._id, status: { $ne: "INACTIVE" } }),
    sessionsIn(facility, windows, "entryTime exitTime"),
  ]);
  const stays = sessions.map((s) => ({ in: s.entryTime.getTime(), out: s.exitTime?.getTime() ?? Math.max(now, s.entryTime.getTime()) }));

  const days = windows.map((w) => {
    const openMs = Math.max(0, w.close - w.open);
    const elapsedMs = Math.max(0, Math.min(w.close, now) - w.open); // a day still in progress counts up to now
    const occupiedMs = stays.reduce((sum, s) => sum + overlap(s.in, s.out, w.open, Math.min(w.close, now)), 0);
    // peak: vehicles inside at once during the day
    const events = stays.filter((s) => s.in < w.end && s.out > w.start)
      .flatMap((s) => [[Math.max(s.in, w.start), 1], [Math.min(s.out, w.end), -1]])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let inside = 0;
    let peak = 0;
    for (const [, change] of events) peak = Math.max(peak, (inside += change));
    const entries = stays.filter((s) => s.in >= w.start && s.in < w.end).length;
    return {
      date: w.date, capacity, openHours: round(openMs / 3600000), entries,
      exits: sessions.filter((s) => s.exitTime && s.exitTime.getTime() >= w.start && s.exitTime.getTime() < w.end).length,
      peakOccupied: peak, occupiedHours: round(occupiedMs / 3600000),
      averageOccupancyPct: capacity && elapsedMs ? round((occupiedMs / (capacity * elapsedMs)) * 100, 1) : 0,
      turnover: capacity ? round(entries / capacity) : 0,
    };
  });
  const sum = (f) => days.reduce((s, d) => s + d[f], 0);
  const measured = days.filter((d) => d.averageOccupancyPct || d.occupiedHours);
  return {
    totals: { capacity, entries: sum("entries"), exits: sum("exits"), peakOccupied: Math.max(0, ...days.map((d) => d.peakOccupied)),
      occupiedHours: round(sum("occupiedHours")),
      averageOccupancyPct: measured.length ? round(measured.reduce((s, d) => s + d.averageOccupancyPct, 0) / measured.length, 1) : 0,
      turnover: capacity ? round(sum("entries") / capacity) : 0 },
    days,
  };
}

async function usageReport({ facility, windows, range }) {
  const [sessions, reservations] = await Promise.all([
    sessionsIn(facility, windows, "entryTime exitTime source vehicleType reservation duration"),
    Reservation.find({ facility: facility._id, startTime: range }, "startTime status").lean(),
  ]);
  const empty = () => ({ entries: 0, anpr: 0, qr: 0, manual: 0, walkIns: 0, booked: 0,
    ...Object.fromEntries(VEHICLE_TYPES.map((t) => [t.toLowerCase(), 0])), exits: 0, stayMinutes: 0,
    bookings: 0, bookingsUsed: 0, bookingsExpired: 0, bookingsCancelled: 0 });
  const rows = Object.fromEntries(windows.map((w) => [w.date, { date: w.date, ...empty() }]));
  const totals = empty();
  const entriesByHour = Array(24).fill(0);

  for (const s of sessions) {
    const entered = dayOf(windows, s.entryTime.getTime());
    if (entered) {
      entriesByHour[Number(localParts(s.entryTime, facility.timezone).time.slice(0, 2))] += 1;
      for (const r of [rows[entered.date], totals]) {
        r.entries += 1;
        r[s.source.toLowerCase()] += 1;
        r[s.reservation ? "booked" : "walkIns"] += 1;
        r[s.vehicleType.toLowerCase()] += 1;
      }
    }
    const left = s.exitTime && dayOf(windows, s.exitTime.getTime());
    if (left) {
      for (const r of [rows[left.date], totals]) {
        r.exits += 1;
        r.stayMinutes += s.duration ?? Math.round((s.exitTime - s.entryTime) / 60000);
      }
    }
  }
  for (const b of reservations) {
    const day = dayOf(windows, b.startTime.getTime());
    if (!day) continue;
    for (const r of [rows[day.date], totals]) {
      r.bookings += 1;
      if (["CHECKED_IN", "COMPLETED"].includes(b.status)) r.bookingsUsed += 1;
      if (b.status === "EXPIRED") r.bookingsExpired += 1;
      if (["CANCELLED", "REFUNDED"].includes(b.status)) r.bookingsCancelled += 1;
    }
  }
  // average stay of the vehicles that left, instead of the sum of minutes
  const finish = ({ stayMinutes, ...r }) => ({ ...r, averageStayMinutes: r.exits ? Math.round(stayMinutes / r.exits) : 0 });
  return { totals: { ...finish(totals), entriesByHour }, days: Object.values(rows).map(finish) };
}

const BUILDERS = { occupancy: occupancyReport, revenue: revenueReport, usage: usageReport };

// GET /api/reports/:type?facilityId&from&to&format
async function buildReport(type, query) {
  const input = await parseQuery(type, query);
  const { facility, from, to, format } = input;
  const body = await BUILDERS[type](input);
  return { format, report: { type, facility: { id: facility.id, name: facility.name, timezone: facility.timezone }, from, to,
    generatedAt: clock.now().toISOString(), ...body } };
}

// CSV (RFC 4180): one row per day and a TOTAL row. A text cell starting with = + - @ is prefixed
// with ' so a spreadsheet doesn't run it as a formula.
function toCsv(report) {
  const columns = Object.keys(report.days[0] ?? { date: "" });
  const cell = (v) => {
    let text = v === undefined || v === null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const totals = { ...report.totals, date: "TOTAL" };
  const lines = [columns, ...report.days.map((d) => columns.map((c) => d[c])), columns.map((c) => totals[c])];
  return `${lines.map((l) => l.map(cell).join(",")).join("\r\n")}\r\n`;
}

const csvFilename = (report) => `${report.type}-${report.facility.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${report.from}-to-${report.to}.csv`;

module.exports = { buildReport, toCsv, csvFilename, REPORT_TYPES };
