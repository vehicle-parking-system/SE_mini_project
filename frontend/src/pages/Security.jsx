import { useCallback, useEffect, useState } from "react";
import { api, ROLE_LABELS } from "../api";

const LOGIN_EVENTS = ["LOGIN_FAILED", "LOGIN_BLOCKED", "ACCOUNT_LOCKED", "ACCOUNT_UNLOCKED", "LOGIN_RATE_LIMITED"];

const formatTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

function describe(log) {
  const d = log.details || {};
  switch (log.event) {
    case "LOGIN_FAILED":
      return d.reason === "UNKNOWN_EMAIL" ? "Login with an unknown email" : `Wrong password (attempt ${d.attempt})`;
    case "LOGIN_BLOCKED": return "Login attempt on a locked account";
    case "ACCOUNT_LOCKED":
      return `${ordinal(d.lockNumber ?? 1)} lock in a row, after ${d.failedAttempts} failed attempts, until ${formatTime(d.lockedUntil)}`;
    case "LOGIN_RATE_LIMITED": return `IP throttled after ${d.limit} failed logins, until ${formatTime(d.until)}`;
    case "ACCOUNT_UNLOCKED": return "Unlocked by an admin";
    default: return "";
  }
}

// Admin only: accounts locked by repeated failed logins (VPS-SR-005) and recent login security events.
export default function Security() {
  const [locked, setLocked] = useState(null);
  const [logs, setLogs] = useState(null);
  const [status, setStatus] = useState(null);
  const [unlocking, setUnlocking] = useState(null);

  const load = useCallback(() => Promise.all([api.lockedAccounts(), api.auditLogs(LOGIN_EVENTS)])
    .then(([l, a]) => { setLocked(l.users); setLogs(a.logs.slice(0, 100)); })
    .catch((err) => setStatus({ kind: "error", text: err.message })), []);
  useEffect(() => { load(); }, [load]);

  async function unlock(user) {
    if (!window.confirm(`Unlock ${user.email}? They will be able to log in again straight away.`)) return;
    setUnlocking(user.id);
    setStatus(null);
    try {
      await api.unlockUser(user.id);
      setStatus({ kind: "success", text: `${user.email} unlocked` });
      await load();
    } catch (err) {
      setStatus({ kind: "error", text: err.message });
    } finally {
      setUnlocking(null);
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Login security</h1>
        <p className="muted">
          Accounts lock automatically after repeated failed logins, for longer each time it happens again. A network
          with too many failed logins is throttled. Unlock an account early once you've confirmed the owner.
        </p>
      </header>
      {status && <p className={`notice ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.text}</p>}

      <div className="stack">
        <section className="card">
          <div className="card-header">
            <h2>Locked accounts</h2>
            <button className="btn small" onClick={load}>Refresh</button>
          </div>
          {!locked ? <p className="muted">Loading…</p>
            : locked.length === 0 ? <p className="muted">No accounts are locked.</p>
              : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Account</th><th>Role</th><th>Locked until</th><th>Locks in a row</th><th>Last failed attempt</th><th /></tr></thead>
                    <tbody>
                      {locked.map((u) => (
                        <tr key={u.id}>
                          <td><strong>{u.name}</strong><br /><span className="muted">{u.email}</span></td>
                          <td>{ROLE_LABELS[u.role]}</td>
                          <td>{formatTime(u.lockedUntil)}</td>
                          <td>{u.lockCount}</td>
                          <td>{u.lastFailedLoginAt ? formatTime(u.lastFailedLoginAt) : "—"}</td>
                          <td>
                            <button className="btn small" disabled={unlocking === u.id} onClick={() => unlock(u)}>
                              {unlocking === u.id ? "Unlocking…" : "Unlock"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </section>

        <section className="card">
          <h2>Recent login events</h2>
          {!logs ? <p className="muted">Loading…</p>
            : logs.length === 0 ? <p className="muted">No failed or blocked logins recorded.</p>
              : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>IP</th></tr></thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id}>
                          <td>{formatTime(l.at)}</td>
                          <td><span className={`event ${l.event}`}>{l.event}</span></td>
                          <td>{describe(l)}</td>
                          <td className="muted">{l.details?.ip ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </section>
      </div>
    </main>
  );
}
