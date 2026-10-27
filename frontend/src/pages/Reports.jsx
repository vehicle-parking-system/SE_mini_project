import { useEffect, useState } from "react";
import { api, formatMoney } from "../api";

const money = (v) => formatMoney(v);
const pct = (v) => `${v}%`;
// [key, column label, format?] per report; the CSV export has the same columns
const REPORTS = {
  revenue: {
    label: "Revenue",
    columns: [["payments", "Payments"], ["gross", "Received", money], ["refunded", "Refunded", money], ["net", "Net", money],
      ["atGate", "At gate", money], ["online", "Online", money], ["parking", "Parking", money], ["bookings", "Bookings", money]],
    summary: (r) => [["Net revenue", money(r.totals.net)], ["Received", money(r.totals.gross)], ["Refunded", money(r.totals.refunded)]],
  },
  occupancy: {
    label: "Occupancy",
    columns: [["averageOccupancyPct", "Avg occupancy", pct], ["peakOccupied", "Peak parked"], ["entries", "Entries"],
      ["exits", "Exits"], ["occupiedHours", "Slot hours used"], ["turnover", "Turnover"], ["capacity", "Slots"]],
    summary: (r) => [["Avg occupancy", pct(r.totals.averageOccupancyPct)], ["Peak parked", `${r.totals.peakOccupied} of ${r.totals.capacity}`],
      ["Turnover", `${r.totals.turnover} per slot`]],
  },
  usage: {
    label: "Usage",
    columns: [["entries", "Entries"], ["walkIns", "Walk-ins"], ["booked", "Booked"], ["anpr", "ANPR"], ["qr", "QR"], ["manual", "Manual"],
      ["car", "Cars"], ["bike", "Bikes"], ["truck", "Trucks"], ["averageStayMinutes", "Avg stay (min)"], ["bookings", "Bookings"],
      ["bookingsExpired", "No-shows"], ["bookingsCancelled", "Cancelled"]],
    summary: (r) => [["Entries", r.totals.entries], ["Avg stay", `${r.totals.averageStayMinutes} min`],
      ["Busiest hour", busiestHour(r.totals.entriesByHour)]],
  },
};

function busiestHour(byHour) {
  const max = Math.max(...byHour);
  if (!max) return "—";
  const h = byHour.indexOf(max);
  return `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`;
}

const isoDate = (d) => d.toISOString().slice(0, 10);
function lastWeek() {
  const to = new Date();
  return { from: isoDate(new Date(to.getTime() - 6 * 86400000)), to: isoDate(to) };
}

function saveBlob({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Admin only: occupancy, revenue and usage per day, exportable as CSV (VPS-F-043)
export default function Reports() {
  const [facilities, setFacilities] = useState(null);
  const [query, setQuery] = useState({ type: "revenue", facilityId: "", ...lastWeek() });
  const [report, setReport] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.facilities().then(({ facilities: list }) => {
      setFacilities(list);
      setQuery((q) => ({ ...q, facilityId: q.facilityId || list[0]?.id || "" }));
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!query.facilityId) return;
    const { type, ...params } = query;
    setReport(null);
    setError(null);
    setErrors({});
    api.report(type, params).then(setReport).catch((err) => {
      setErrors(err.details || {});
      setError(err.message);
    });
  }, [query]);

  async function exportCsv() {
    const { type, ...params } = query;
    setBusy(true);
    try {
      saveBlob(await api.reportCsv(type, params));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !facilities) return <main className="page"><p className="notice error" role="alert">{error}</p></main>;
  if (!facilities) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!facilities.length) return <main className="page"><h1>Reports</h1><p className="muted">No facilities have been set up yet.</p></main>;
  const def = REPORTS[query.type];
  const set = (patch) => setQuery({ ...query, ...patch });

  return (
    <main className="page wide">
      <header className="page-header">
        <h1>Reports</h1>
        <p className="muted">Each facility&apos;s days in its own time zone. Export any report as CSV for a spreadsheet.</p>
      </header>
      <section className="card">
        <div className="segmented" role="radiogroup" aria-label="Report">
          {Object.entries(REPORTS).map(([type, r]) => (
            <button key={type} type="button" role="radio" aria-checked={query.type === type} className={query.type === type ? "active" : ""}
              onClick={() => set({ type })}>{r.label}</button>
          ))}
        </div>
        <div className="report-filters">
          <div className="field">
            <label htmlFor="reportFacility">Facility</label>
            <select id="reportFacility" value={query.facilityId} onChange={(e) => set({ facilityId: e.target.value })}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className={`field${errors.from ? " has-error" : ""}`}>
            <label htmlFor="reportFrom">From</label>
            <input id="reportFrom" type="date" value={query.from} max={query.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            {errors.from && <p className="field-error">{errors.from}</p>}
          </div>
          <div className={`field${errors.to ? " has-error" : ""}`}>
            <label htmlFor="reportTo">To</label>
            <input id="reportTo" type="date" value={query.to} min={query.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
            {errors.to && <p className="field-error">{errors.to}</p>}
          </div>
          <button type="button" className="btn" onClick={exportCsv} disabled={busy || !report}>{busy ? "Exporting…" : "Export CSV"}</button>
        </div>
      </section>

      {error && facilities && <p className="notice error report-error" role="alert">{error}</p>}
      {!report ? !error && <p className="muted report-error">Loading…</p> : (
        <section className="card report">
          <dl className="report-summary">
            {def.summary(report).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <div className="table-wrap">
            <table className="numeric">
              <thead><tr><th>Date</th>{def.columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
              <tbody>
                {report.days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    {def.columns.map(([key, , fmt]) => <td key={key}>{fmt ? fmt(d[key]) : d[key]}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {def.columns.map(([key, , fmt]) => <td key={key}>{report.totals[key] === undefined ? "" : fmt ? fmt(report.totals[key]) : report.totals[key]}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
