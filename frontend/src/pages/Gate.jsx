import { useCallback, useEffect, useState } from "react";
import { api, formatDuration, formatMoney, VEHICLE_TYPES } from "../api";
import Ticket from "../components/Ticket";
import { formatTime } from "../time";

const GATE_KEY = "vps.gate";
const REFRESH_MS = 30000;
const SOURCES = [
  { value: "ANPR", label: "ANPR" },
  { value: "QR", label: "QR scan" },
  { value: "MANUAL", label: "Manual" },
];

function readSaved() {
  try { return JSON.parse(localStorage.getItem(GATE_KEY)) || {}; } catch { return {}; }
}
function save(value) {
  try { localStorage.setItem(GATE_KEY, JSON.stringify(value)); } catch { /* storage blocked */ }
}

// Vehicle entry (VPS-F-001): the plate read by the ANPR camera or typed by the attendant,
// or a booking's QR code, opens a parking session and tells the driver where to park.
function EntryPanel({ gate, facility, onEntered }) {
  const [form, setForm] = useState({ source: "ANPR", plateNumber: "", vehicleType: "CAR", qrCode: "" });
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null); // {kind: "success"|"error", session?, text}
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm({ ...form, ...patch });
  const isQr = form.source === "QR";

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setResult(null);
    try {
      const session = await api.enter({
        gateId: gate.id, source: form.source,
        ...(isQr ? { qrCode: form.qrCode } : { plateNumber: form.plateNumber, vehicleType: form.vehicleType }),
      });
      setResult({ kind: "success", session });
      setForm({ ...form, plateNumber: "", qrCode: "" });
      onEntered(session);
    } catch (err) {
      setErrors(err.details || {});
      setResult({ kind: "error", text: err.message });
      onEntered(); // a refusal may mean the facility just filled up
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>Vehicle entry</h2>
      <div className="segmented" role="radiogroup" aria-label="How the vehicle was identified">
        {SOURCES.map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={form.source === s.value}
            className={form.source === s.value ? "active" : ""} onClick={() => set({ source: s.value })}>{s.label}</button>
        ))}
      </div>
      {isQr ? (
        <div className={`field${errors.qrCode ? " has-error" : ""}`}>
          <label htmlFor="qrCode">Booking QR code</label>
          <input id="qrCode" value={form.qrCode} onChange={(e) => set({ qrCode: e.target.value })} autoComplete="off"
            placeholder="Scan or paste the code" aria-invalid={Boolean(errors.qrCode)} />
          {errors.qrCode && <p className="field-error">{errors.qrCode}</p>}
        </div>
      ) : (
        <div className="row">
          <div className={`field${errors.plateNumber ? " has-error" : ""}`}>
            <label htmlFor="plateNumber">Number plate</label>
            <input id="plateNumber" value={form.plateNumber} autoComplete="off" placeholder="KA01AB1234"
              onChange={(e) => set({ plateNumber: e.target.value.toUpperCase() })} aria-invalid={Boolean(errors.plateNumber)} />
            {errors.plateNumber && <p className="field-error">{errors.plateNumber}</p>}
          </div>
          <div className="field">
            <label htmlFor="vehicleType">Vehicle type</label>
            <select id="vehicleType" value={form.vehicleType} onChange={(e) => set({ vehicleType: e.target.value })}>
              {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
      )}
      <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Admit vehicle"}</button>

      {result?.kind === "error" && <p className="notice error gate-result" role="alert">{result.text}</p>}
      {result?.kind === "success" && (
        <>
          <div className="notice success gate-result" role="status">
            <strong>Barrier opened.</strong> {result.session.plateNumber} → slot <span className="plate">{result.session.slotNumber}</span>
            {" "}({result.session.zoneName}){result.session.reservationId && " · booked"}
          </div>
          <Ticket session={result.session} facilityName={facility.name} timezone={facility.timezone} onPrint={() => window.print()} />
        </>
      )}
    </form>
  );
}

// Vehicle exit (VPS-F-010): find the vehicle by its entry ticket or plate and show the fee for its stay.
function ExitPanel({ gate, onChanged }) {
  const [by, setBy] = useState("QR");
  const [value, setValue] = useState("");
  const [result, setResult] = useState(null); // {kind: "due"|"done"|"error", ...}
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const done = await api.exit({ gateId: gate.id, ...(by === "QR" ? { qrCode: value } : { plateNumber: value }) });
      setResult({ kind: "done", ...done });
      setValue("");
    } catch (err) {
      setResult(err.status === 402 ? { kind: "due", ...err.data } : { kind: "error", text: err.message });
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>Vehicle exit</h2>
      <div className="segmented" role="radiogroup" aria-label="How to find the vehicle">
        {[["QR", "Ticket scan"], ["PLATE", "Number plate"]].map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={by === v} className={by === v ? "active" : ""}
            onClick={() => { setBy(v); setValue(""); }}>{label}</button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="exitLookup">{by === "QR" ? "Entry ticket code" : "Number plate"}</label>
        <input id="exitLookup" value={value} autoComplete="off" placeholder={by === "QR" ? "Scan or paste the ticket" : "KA01AB1234"}
          onChange={(e) => setValue(by === "QR" ? e.target.value : e.target.value.toUpperCase())} />
      </div>
      <button className="btn primary" disabled={busy || !value.trim()}>{busy ? "Checking…" : "Calculate fee"}</button>

      {result?.kind === "error" && <p className="notice error gate-result" role="alert">{result.text}</p>}
      {result?.kind === "due" && (
        <div className="fee gate-result" role="status">
          <p className="fee-amount">{formatMoney(result.amount)} <span className="muted">due</span></p>
          <p className="muted">
            {formatDuration(result.duration)} parked · {result.chargedHours} h × {formatMoney(result.ratePerHour)}
            {result.paid > 0 && <> · {formatMoney(result.paid)} already paid</>}
          </p>
          <p className="muted small">The barrier opens once the fee is paid.</p>
        </div>
      )}
    </form>
  );
}

const typeLabel = (value) => VEHICLE_TYPES.find((t) => t.value === value)?.label ?? value;

// Live occupancy (VPS-F-003): free slots per vehicle type, so the attendant sees "full" before a car arrives.
function OccupancyCard({ occupancy }) {
  if (!occupancy) return <section className="card"><h2>Occupancy</h2><p className="muted">Loading…</p></section>;
  const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);
  return (
    <section className="card occupancy">
      <div className="card-header">
        <h2>Occupancy</h2>
        {occupancy.full ? <span className="status-badge FAILED">Facility Full</span>
          : <span className="muted">{occupancy.free} of {occupancy.capacity} free</span>}
      </div>
      <ul className="meter-list">
        {occupancy.byVehicleType.map((t) => (
          <li key={t.vehicleType}>
            <div className="meter-label">
              <span>{typeLabel(t.vehicleType)}</span>
              <span className={t.full ? "danger-text" : "muted"}>{t.full ? "Full" : `${t.free} free`} · {t.occupied} parked{t.booked ? ` · ${t.booked} booked` : ""}</span>
            </div>
            <div className="meter" role="img" aria-label={`${typeLabel(t.vehicleType)}: ${t.occupied} parked, ${t.booked} booked, ${t.free} free of ${t.capacity}`}>
              <span className="meter-occupied" style={{ width: `${pct(t.occupied, t.capacity)}%` }} />
              <span className="meter-booked" style={{ width: `${pct(t.booked, t.capacity)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InsideList({ sessions, timezone }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>Vehicles inside</h2>
        <span className="muted">{sessions ? sessions.length : "…"}</span>
      </div>
      {!sessions ? <p className="muted">Loading…</p>
        : sessions.length === 0 ? <p className="muted">No vehicles parked.</p>
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Plate</th><th>Slot</th><th>Entered</th><th>How</th></tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.sessionId}>
                      <td><span className="plate">{s.plateNumber}</span></td>
                      <td><strong>{s.slotNumber}</strong><br /><span className="muted small">{s.zoneName}</span></td>
                      <td>{formatTime(s.entryTime, timezone)}</td>
                      <td className="muted">{s.source}{s.reservationId ? " · booked" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  );
}

// Attendant kiosk: pick the facility and gate this screen is at, then run the gate.
export default function Gate() {
  const [facilities, setFacilities] = useState(null);
  const [selection, setSelection] = useState(readSaved);
  const [sessions, setSessions] = useState(null);
  const [occupancy, setOccupancy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.facilities().then(({ facilities: list }) => {
      setFacilities(list);
      setSelection((current) => {
        const facility = list.find((f) => f.id === current.facilityId) ?? list[0];
        if (!facility) return {};
        const gates = facility.gates ?? [];
        const pick = (type, id) => (gates.find((g) => g.id === id && g.type === type) ?? gates.find((g) => g.type === type))?.id;
        return { facilityId: facility.id, entryGateId: pick("ENTRY", current.entryGateId), exitGateId: pick("EXIT", current.exitGateId) };
      });
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { if (selection.facilityId) save(selection); }, [selection]);

  // Vehicles inside and occupancy, refreshed after every gate action and every 30 s
  const refresh = useCallback(() => {
    if (!selection.facilityId) return;
    api.sessions({ facilityId: selection.facilityId, status: "ACTIVE" })
      .then(({ sessions: list }) => setSessions(list))
      .catch((err) => setError(err.message));
    api.occupancy(selection.facilityId).then(setOccupancy).catch((err) => setError(err.message));
  }, [selection.facilityId]);

  useEffect(() => {
    setSessions(null);
    setOccupancy(null);
    refresh();
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (error && !facilities) return <main className="page"><p className="notice error" role="alert">{error}</p></main>;
  if (!facilities) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!selection.facilityId) {
    return <main className="page"><h1>Gate</h1><p className="muted">No parking facilities have been set up yet.</p></main>;
  }

  const facility = facilities.find((f) => f.id === selection.facilityId);
  const entryGates = facility.gates.filter((g) => g.type === "ENTRY");
  const entryGate = entryGates.find((g) => g.id === selection.entryGateId);
  const exitGates = facility.gates.filter((g) => g.type === "EXIT");
  const exitGate = exitGates.find((g) => g.id === selection.exitGateId);

  const onFacility = (e) => {
    const next = facilities.find((f) => f.id === e.target.value);
    setSelection({ facilityId: next.id, entryGateId: next.gates.find((g) => g.type === "ENTRY")?.id,
      exitGateId: next.gates.find((g) => g.type === "EXIT")?.id });
  };

  return (
    <main className="page">
      <header className="page-header gate-header">
        <div>
          <h1>Gate</h1>
          <p className="muted">Admit vehicles at the entry barrier and let them out at the exit.</p>
        </div>
        <div className="row gate-pick">
          <div className="field">
            <label htmlFor="facility">Facility</label>
            <select id="facility" value={facility.id} onChange={onFacility}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="entryGate">Entry gate</label>
            <select id="entryGate" value={entryGate?.id ?? ""} onChange={(e) => setSelection({ ...selection, entryGateId: e.target.value })}>
              {entryGates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="exitGate">Exit gate</label>
            <select id="exitGate" value={exitGate?.id ?? ""} onChange={(e) => setSelection({ ...selection, exitGateId: e.target.value })}>
              {exitGates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
      </header>
      <div className="grid">
        <div className="stack">
          {entryGate ? <EntryPanel gate={entryGate} facility={facility} onEntered={refresh} />
            : <div className="card"><p className="muted">This facility has no entry gate.</p></div>}
          {exitGate ? <ExitPanel gate={exitGate} onChanged={refresh} />
            : <div className="card"><p className="muted">This facility has no exit gate.</p></div>}
        </div>
        <div className="stack">
          <OccupancyCard occupancy={occupancy} />
          <InsideList sessions={sessions} timezone={facility.timezone} />
        </div>
      </div>
    </main>
  );
}
