import { useCallback, useEffect, useRef, useState } from "react";
import { api, VEHICLE_TYPES } from "../api";
import { defaultWindow, formatDay, formatTime, zonedIso } from "../time";

const REFRESH_MS = 30000;
const typeLabel = (value) => VEHICLE_TYPES.find((t) => t.value === value)?.label ?? value;

// Real-time slot search (VPS-F-021): pick a facility, zone, vehicle and time window and
// see the free slots, nearest to the entrance first. Results refresh every 30 seconds.
export default function Search() {
  const [facilities, setFacilities] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const lastQuery = useRef(null);

  useEffect(() => {
    Promise.all([api.facilities(), api.me()])
      .then(([f, me]) => {
        setFacilities(f.facilities);
        setVehicles(me.vehicles);
        const first = f.facilities[0];
        if (first) {
          setForm({ facilityId: first.id, zoneId: "", vehicleType: me.vehicles[0]?.vehicleType ?? "CAR",
            ...defaultWindow(first.timezone) });
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  const facility = facilities?.find((f) => f.id === form?.facilityId);

  const run = useCallback(async (query, { quiet = false } = {}) => {
    if (!quiet) { setBusy(true); setError(null); setErrors({}); }
    try {
      setResult(await api.searchSlots(query));
      lastQuery.current = query;
    } catch (err) {
      if (quiet) return; // keep showing the last results if a background refresh fails
      setResult(null);
      lastQuery.current = null;
      setError(err.message);
      setErrors(err.details || {});
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  // Real-time: re-run the last search every 30 s while the page is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (lastQuery.current && document.visibilityState === "visible") run(lastQuery.current, { quiet: true });
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [run]);

  if (error && !facilities) return <main className="page"><p className="notice error" role="alert">{error}</p></main>;
  if (!facilities) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!form) {
    return (
      <main className="page">
        <h1>Find parking</h1>
        <p className="muted">No parking facilities have been set up yet.</p>
      </main>
    );
  }

  const set = (patch) => setForm({ ...form, ...patch });
  const onFacility = (e) => {
    const next = facilities.find((f) => f.id === e.target.value);
    set({ facilityId: next.id, zoneId: "", ...defaultWindow(next.timezone) });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const query = {
      facilityId: form.facilityId, vehicleType: form.vehicleType,
      startTime: zonedIso(form.date, form.start, facility.timezone),
      endTime: zonedIso(form.date, form.end, facility.timezone),
      ...(form.zoneId && { zoneId: form.zoneId }),
    };
    run(query);
  };

  const tz = result?.facility.timezone;

  return (
    <main className="page">
      <header className="page-header">
        <h1>Find parking</h1>
        <p className="muted">See which slots are free for your whole stay before you set off.</p>
      </header>

      <form className="card search-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="facility">Facility</label>
          <select id="facility" value={form.facilityId} onChange={onFacility}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <p className="field-hint">Open {facility.openTime}–{facility.closeTime}</p>
        </div>
        <div className="field">
          <label htmlFor="zone">Zone</label>
          <select id="zone" value={form.zoneId} onChange={(e) => set({ zoneId: e.target.value })}>
            <option value="">All zones</option>
            {facility.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="vehicleType">Vehicle</label>
          <select id="vehicleType" value={form.vehicleType} onChange={(e) => set({ vehicleType: e.target.value })}>
            {VEHICLE_TYPES.map((t) => {
              const mine = vehicles.filter((v) => v.vehicleType === t.value).map((v) => v.plateNumber);
              return <option key={t.value} value={t.value}>{t.label}{mine.length ? ` (${mine.join(", ")})` : ""}</option>;
            })}
          </select>
        </div>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="start">From</label>
          <input id="start" type="time" step="900" value={form.start} onChange={(e) => set({ start: e.target.value })}
            aria-invalid={Boolean(errors.startTime)} />
        </div>
        <div className="field">
          <label htmlFor="end">Until</label>
          <input id="end" type="time" step="900" value={form.end} onChange={(e) => set({ end: e.target.value })}
            aria-invalid={Boolean(errors.endTime)} />
          {errors.endTime && <p className="field-error">{errors.endTime}</p>}
        </div>
        <button className="btn primary search-submit" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>

      {error && <p className="notice error search-message" role="alert">{error}</p>}

      {result && (
        <section className="card results" aria-live="polite">
          <div className="card-header">
            <h2>
              {result.slots.length === 0 ? "No free slots" : `${result.slots.length} free slot${result.slots.length === 1 ? "" : "s"}`}
              {" "}at {result.facility.name}
            </h2>
          </div>
          <p className="muted results-meta">
            {formatDay(result.window.startTime, tz)}, {formatTime(result.window.startTime, tz)}–{formatTime(result.window.endTime, tz)}
            {" · "}{typeLabel(lastQuery.current?.vehicleType)}
            {" · "}updated {formatTime(result.checkedAt, tz)}, refreshes every 30 s
          </p>
          {result.slots.length === 0
            ? <p className="muted">Try another zone, a shorter stay or a different time.</p>
            : (
              <ul className="slot-list">
                {result.slots.map((s, i) => (
                  <li key={s.slotId} className="slot">
                    <span className="plate">{s.number}</span>
                    <span>{s.zoneName}</span>
                    <span className="muted">{s.distance} m from the entrance</span>
                    {i === 0 && <span className="role-badge">Nearest</span>}
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </main>
  );
}
