import { useCallback, useEffect, useState } from "react";
import { api, VEHICLE_TYPES } from "../api";
import { formatTime } from "../time";

const GATE_KEY = "vps.gate";
const REFRESH_MS = 30000;
const SOURCES = [
  { value: "ANPR", label: "ANPR camera" },
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
function EntryPanel({ gate, onEntered }) {
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
        <div className="notice success gate-result" role="status">
          <strong>Barrier opened.</strong> {result.session.plateNumber} → slot <span className="plate">{result.session.slotNumber}</span>
          {" "}({result.session.zoneName}){result.session.reservationId && " · booked"}
        </div>
      )}
    </form>
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
                      <td>{s.slotNumber} <span className="muted">{s.zoneName}</span></td>
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
  const [error, setError] = useState(null);

  useEffect(() => {
    api.facilities().then(({ facilities: list }) => {
      setFacilities(list);
      setSelection((current) => {
        const facility = list.find((f) => f.id === current.facilityId) ?? list[0];
        if (!facility) return {};
        const gates = facility.gates ?? [];
        const entryGate = gates.find((g) => g.id === current.entryGateId) ?? gates.find((g) => g.type === "ENTRY");
        return { facilityId: facility.id, entryGateId: entryGate?.id };
      });
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { if (selection.facilityId) save(selection); }, [selection]);

  const loadSessions = useCallback(() => {
    if (!selection.facilityId) return;
    api.sessions({ facilityId: selection.facilityId, status: "ACTIVE" })
      .then(({ sessions: list }) => setSessions(list))
      .catch((err) => setError(err.message));
  }, [selection.facilityId]);

  useEffect(() => {
    setSessions(null);
    loadSessions();
    const id = setInterval(() => document.visibilityState === "visible" && loadSessions(), REFRESH_MS);
    return () => clearInterval(id);
  }, [loadSessions]);

  if (error && !facilities) return <main className="page"><p className="notice error" role="alert">{error}</p></main>;
  if (!facilities) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!selection.facilityId) {
    return <main className="page"><h1>Gate</h1><p className="muted">No parking facilities have been set up yet.</p></main>;
  }

  const facility = facilities.find((f) => f.id === selection.facilityId);
  const entryGates = facility.gates.filter((g) => g.type === "ENTRY");
  const entryGate = entryGates.find((g) => g.id === selection.entryGateId);

  const onFacility = (e) => {
    const next = facilities.find((f) => f.id === e.target.value);
    setSelection({ facilityId: next.id, entryGateId: next.gates.find((g) => g.type === "ENTRY")?.id });
  };

  return (
    <main className="page">
      <header className="page-header gate-header">
        <div>
          <h1>Gate</h1>
          <p className="muted">Admit vehicles at the entry barrier.</p>
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
        </div>
      </header>
      <div className="grid">
        {entryGate ? <EntryPanel gate={entryGate} onEntered={loadSessions} />
          : <div className="card"><p className="muted">This facility has no entry gate.</p></div>}
        <InsideList sessions={sessions} timezone={facility.timezone} />
      </div>
    </main>
  );
}
