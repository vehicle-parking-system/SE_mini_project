import { useCallback, useEffect, useState } from "react";
import { api, liveEvents } from "../api";
import OccupancyCard from "../components/OccupancyCard";
import { formatTime } from "../time";

const FACILITY_KEY = "vps.monitor";
const GATE_POLL_MS = 5000;
const REFRESH_MS = 30000;
const REASONS = [
  ["ANPR_FAILURE", "Number plate camera not working"],
  ["SCANNER_FAILURE", "QR scanner not working"],
  ["BARRIER_FAULT", "Barrier or sensor fault"],
  ["PAYMENT_TERMINAL_FAILURE", "Card terminal not working"],
  ["EMERGENCY", "Emergency"],
  ["OTHER", "Other"],
];
const REASON_LABEL = Object.fromEntries(REASONS);

function readSaved() {
  try { return localStorage.getItem(FACILITY_KEY) || ""; } catch { return ""; }
}
function save(id) {
  try { localStorage.setItem(FACILITY_KEY, id); } catch { /* storage blocked */ }
}

// Opening or closing one barrier by hand. Needs a reason; every override is audited.
function OverrideForm({ gate, action, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      onDone(await api.overrideGate(gate.id, { action, reason, ...(note.trim() && { note: note.trim() }) }));
    } catch (err) {
      setErrors({ ...err.details, form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="override-form" onSubmit={onSubmit} noValidate>
      <div className={`field${errors.reason ? " has-error" : ""}`}>
        <label htmlFor={`reason-${gate.id}`}>Why are you {action === "OPEN" ? "opening" : "closing"} {gate.name} by hand?</label>
        <select id={`reason-${gate.id}`} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(errors.reason)}>
          <option value="" disabled>Choose a reason</option>
          {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {errors.reason && <p className="field-error">{errors.reason}</p>}
      </div>
      <div className={`field${errors.note ? " has-error" : ""}`}>
        <label htmlFor={`note-${gate.id}`}>Note {reason !== "OTHER" && <span className="muted">(optional)</span>}</label>
        <input id={`note-${gate.id}`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-invalid={Boolean(errors.note)} />
        {errors.note && <p className="field-error">{errors.note}</p>}
      </div>
      <div className="booking-actions">
        <button className={`btn ${action === "OPEN" ? "primary" : ""}`} disabled={busy || !reason}>
          {busy ? "Sending…" : action === "OPEN" ? "Open barrier" : "Close barrier"}
        </button>
        <button type="button" className="btn link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function GateRow({ gate, onOverride }) {
  const [action, setAction] = useState(null);
  const [result, setResult] = useState(null);
  return (
    <li className="gate-row">
      <div className="gate-row-head">
        <div>
          <strong>{gate.name}</strong> <span className="muted small">{gate.type === "ENTRY" ? "Entry" : "Exit"}</span>
          <div className="small">
            {gate.online ? <span className="link-ok">● Connected</span> : <span className="danger-text">● No connection</span>}
            {gate.queued > 0 && <span className="muted"> · {gate.queued} command{gate.queued === 1 ? "" : "s"} waiting</span>}
          </div>
        </div>
        {!action && (
          <div className="booking-actions">
            <button type="button" className="btn small" onClick={() => { setResult(null); setAction("OPEN"); }}>Open…</button>
            <button type="button" className="btn small" onClick={() => { setResult(null); setAction("CLOSE"); }}>Close…</button>
          </div>
        )}
      </div>
      {action && (
        <OverrideForm gate={gate} action={action} onCancel={() => setAction(null)} onDone={(r) => {
          setAction(null);
          setResult(r);
          onOverride();
        }} />
      )}
      {result && (
        <p className={`notice ${result.delivered ? "success" : "error"}`} role="status">
          {result.delivered ? `Barrier ${result.action === "OPEN" ? "opened" : "closed"}.`
            : "The gate isn't reachable. The command will be sent as soon as the connection is back."}
        </p>
      )}
    </li>
  );
}

function OverrideLog({ logs, timezone }) {
  return (
    <section className="card">
      <h2>Manual overrides</h2>
      {!logs ? <p className="muted">Loading…</p>
        : logs.length === 0 ? <p className="muted">None recorded.</p>
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td>{formatTime(l.at, timezone)}</td>
                      <td className="small">{l.actorEmail}</td>
                      <td className="small">
                        {l.details.kind === "MANUAL_ENTRY"
                          ? <>Admitted <span className="plate">{l.details.plateNumber}</span> by typed plate at {l.details.gateName}</>
                          : <>{l.details.action === "OPEN" ? "Opened" : "Closed"} {l.details.gateName}: {REASON_LABEL[l.details.reason] ?? l.details.reason}
                            {l.details.note && <span className="muted"> ({l.details.note})</span>}</>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  );
}

// Staff: live occupancy of a facility, the connection to each of its gates, and manual
// barrier override for when a camera, scanner, terminal or barrier fails (VPS-F-042).
export default function Monitor() {
  const [facilities, setFacilities] = useState(null);
  const [facilityId, setFacilityId] = useState(readSaved);
  const [occupancy, setOccupancy] = useState(null);
  const [gates, setGates] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.facilities().then(({ facilities: list }) => {
      setFacilities(list);
      setFacilityId((id) => (list.some((f) => f.id === id) ? id : list[0]?.id ?? ""));
    }).catch((err) => setError(err.message));
  }, []);
  useEffect(() => { if (facilityId) save(facilityId); }, [facilityId]);

  const refreshOccupancy = useCallback(() => {
    if (facilityId) api.occupancy(facilityId).then(setOccupancy).catch((err) => setError(err.message));
  }, [facilityId]);
  const refreshGates = useCallback(() => {
    if (!facilityId) return;
    api.gateStatus(facilityId).then((r) => setGates(r.gates)).catch((err) => setError(err.message));
    api.gateOverrides(facilityId).then((r) => setLogs(r.logs)).catch((err) => setError(err.message));
  }, [facilityId]);

  useEffect(() => {
    setOccupancy(null);
    setGates(null);
    setLogs(null);
    refreshOccupancy();
    refreshGates();
    const visible = () => document.visibilityState === "visible";
    const occ = setInterval(() => visible() && refreshOccupancy(), REFRESH_MS);
    const gate = setInterval(() => visible() && refreshGates(), GATE_POLL_MS);
    return () => { clearInterval(occ); clearInterval(gate); };
  }, [refreshOccupancy, refreshGates]);

  // Live: any slot change at this facility updates occupancy at once
  useEffect(() => {
    if (!facilityId) return undefined;
    let timer = null;
    const close = liveEvents({ facilityId }, () => {
      clearTimeout(timer);
      timer = setTimeout(refreshOccupancy, 300);
    });
    return () => { clearTimeout(timer); close(); };
  }, [facilityId, refreshOccupancy]);

  if (error && !facilities) return <main className="page"><p className="notice error" role="alert">{error}</p></main>;
  if (!facilities) return <main className="page"><p className="muted">Loading…</p></main>;
  const facility = facilities.find((f) => f.id === facilityId);
  if (!facility) return <main className="page"><h1>Monitor</h1><p className="muted">No parking facilities have been set up yet.</p></main>;
  const offline = (gates ?? []).filter((g) => !g.online);

  return (
    <main className="page">
      <header className="page-header gate-header">
        <div>
          <h1>Monitor</h1>
          <p className="muted">Live occupancy and gate connections. Open or close a barrier by hand when its equipment fails.</p>
        </div>
        <div className="field facility-pick">
          <label htmlFor="monitorFacility">Facility</label>
          <select id="monitorFacility" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {offline.length > 0 && (
        <p className="notice error" role="alert">
          {offline.map((g) => g.name).join(", ")} {offline.length === 1 ? "isn't" : "aren't"} responding. Commands are queued and will be sent when the connection is back.
        </p>
      )}
      <div className="grid">
        <OccupancyCard occupancy={occupancy} title="Live occupancy" byZone />
        <div className="stack">
          <section className="card">
            <h2>Gates</h2>
            {!gates ? <p className="muted">Loading…</p> : (
              <ul className="gate-list">
                {gates.map((g) => <GateRow key={g.id} gate={g} onOverride={refreshGates} />)}
              </ul>
            )}
          </section>
          <OverrideLog logs={logs} timezone={facility.timezone} />
        </div>
      </div>
    </main>
  );
}
