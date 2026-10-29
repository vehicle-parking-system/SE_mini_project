import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

const isoDate = (d) => d.toISOString().slice(0, 10);
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
const size = (bytes) => (!bytes ? "0 KB" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function ArchiveCard() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.archiveStatus().then(setStatus).catch((err) => setMessage({ kind: "error", text: err.message })), []);
  useEffect(() => { load(); }, [load]);

  async function runNow() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.runArchive();
      const moved = r.archived.access.entries + r.archived.audit.entries;
      setMessage({ kind: "success", text: `Archived ${moved} entr${moved === 1 ? "y" : "ies"}${r.purgedFiles ? `, deleted ${r.purgedFiles} expired file(s)` : ""}.` });
      await load();
    } catch (err) {
      setMessage({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const total = (c) => status?.totals[c] ?? { files: 0, entries: 0, bytes: 0 };
  return (
    <section className="card">
      <div className="card-header">
        <h2>Retention</h2>
        <button type="button" className="btn small" onClick={runNow} disabled={busy}>{busy ? "Archiving…" : "Archive now"}</button>
      </div>
      {message && <p className={`notice ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      {!status ? <p className="muted">Loading…</p> : (
        <>
          <p className="muted small">
            Access and audit logs stay searchable here for {status.hotDays} days, then move to checksummed archive files kept for
            {" "}{status.retentionDays} days. Payments, refunds and receipts are never deleted. The archive runs every day.
          </p>
          <dl className="report-summary">
            <div><dt>Access log archive</dt><dd>{total("accesslogs").entries.toLocaleString()}</dd></div>
            <div><dt>Audit log archive</dt><dd>{total("auditlogs").entries.toLocaleString()}</dd></div>
            <div><dt>Files</dt><dd>{total("accesslogs").files + total("auditlogs").files}</dd></div>
            <div><dt>Size</dt><dd>{size(total("accesslogs").bytes + total("auditlogs").bytes)}</dd></div>
          </dl>
          <p className="muted small">Last run: {status.lastRun ? when(status.lastRun.at) : "not yet"}</p>
        </>
      )}
    </section>
  );
}

// Admin only: search access and audit logs across the database and the archive (VPS-NF-004)
export default function Logs() {
  const today = new Date();
  const [query, setQuery] = useState({ type: "access", from: isoDate(new Date(today.getTime() - 7 * 86400000)), to: isoDate(today),
    path: "", status: "", event: "" });
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setQuery({ ...query, ...patch });

  async function onSubmit(e) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const params = Object.fromEntries(Object.entries({ type: query.type, from: query.from, to: query.to,
      ...(query.type === "access" ? { path: query.path, status: query.status } : { event: query.event }) }).filter(([, v]) => v));
    try {
      setResult(await api.searchLogs(params));
    } catch (err) {
      setErrors(err.details || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSubmit(); }, [query.type]);

  const field = (name, label, props = {}) => (
    <div className={`field${errors[name] ? " has-error" : ""}`}>
      <label htmlFor={`log-${name}`}>{label}</label>
      <input id={`log-${name}`} value={query[name]} onChange={(e) => set({ [name]: e.target.value })} {...props} />
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );

  return (
    <main className="page wide">
      <header className="page-header">
        <h1>Logs</h1>
        <p className="muted">Every API request and security event, kept for at least a year. Older entries are read from the archive.</p>
      </header>
      <div className="stack">
        <ArchiveCard />
        <form className="card" onSubmit={onSubmit} noValidate>
          <div className="segmented" role="radiogroup" aria-label="Log">
            {[["access", "Access log"], ["audit", "Audit log"]].map(([type, label]) => (
              <button key={type} type="button" role="radio" aria-checked={query.type === type} className={query.type === type ? "active" : ""}
                onClick={() => { setResult(null); set({ type }); }}>{label}</button>
            ))}
          </div>
          <div className="report-filters">
            {field("from", "From (UTC)", { type: "date" })}
            {field("to", "To (UTC)", { type: "date" })}
            {query.type === "access" ? (
              <>
                {field("path", "Path starts with", { placeholder: "/api/exit" })}
                {field("status", "Status", { placeholder: "403", inputMode: "numeric" })}
              </>
            ) : field("event", "Events", { placeholder: "MANUAL_OVERRIDE,ACCOUNT_LOCKED" })}
            <button className="btn primary" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
          </div>
        </form>

        {error && <p className="notice error" role="alert">{error}</p>}
        {result && (
          <section className="card">
            <div className="card-header">
              <h2>{result.logs.length} entr{result.logs.length === 1 ? "y" : "ies"}</h2>
              <span className="muted small">{result.sources.database} from the database · {result.sources.archive} from {result.filesRead} archive file(s)</span>
            </div>
            {result.integrity.length > 0 && (
              <p className="notice error" role="alert">
                {result.integrity.length} archive file(s) failed their integrity check and were left out: {result.integrity.map((i) => `${i.file} (${i.error})`).join(", ")}
              </p>
            )}
            {result.logs.length === 0 ? <p className="muted">Nothing matches.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    {query.type === "access"
                      ? <tr><th>When</th><th>Request</th><th>Status</th><th>Who</th><th>Took</th><th /></tr>
                      : <tr><th>When</th><th>Event</th><th>Who</th><th>Details</th><th /></tr>}
                  </thead>
                  <tbody>
                    {result.logs.map((l) => (query.type === "access" ? (
                      <tr key={l.id}>
                        <td className="small">{when(l.at)}</td>
                        <td><code className="small">{l.method} {l.path}</code></td>
                        <td>{l.status}</td>
                        <td className="small">{l.role ? `${l.role.toLowerCase()} ${l.userId?.slice(-6)}` : "anonymous"}<br /><span className="muted">{l.ip}</span></td>
                        <td className="small">{l.ms ?? "—"} ms</td>
                        <td>{l.source === "archive" && <span className="status-badge">archived</span>}</td>
                      </tr>
                    ) : (
                      <tr key={l.id}>
                        <td className="small">{when(l.at)}</td>
                        <td><span className={`event ${l.event}`}>{l.event}</span></td>
                        <td className="small">{l.actorEmail ?? (l.actorId ? `user ${l.actorId.slice(-6)}` : "system")}</td>
                        <td><code className="small log-details">{l.details ? JSON.stringify(l.details) : ""}</code></td>
                        <td>{l.source === "archive" && <span className="status-badge">archived</span>}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
