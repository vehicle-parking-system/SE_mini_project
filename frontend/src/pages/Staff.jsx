import { useEffect, useState } from "react";
import { api } from "../api";
import Field from "../components/Field";

const empty = { name: "", email: "", phone: "", password: "" };

// Admin only: attendant accounts. Attendants can't self-register; an admin creates them here.
export default function Staff() {
  const [attendants, setAttendants] = useState(null);
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listAttendants()
    .then(({ users }) => setAttendants(users))
    .catch((err) => setStatus({ kind: "error", text: err.message }));
  useEffect(() => { load(); }, []);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    setErrors({});
    try {
      const { user } = await api.createAttendant(form);
      setStatus({ kind: "success", text: `Attendant account created for ${user.email}` });
      setForm(empty);
      await load();
    } catch (err) {
      setErrors(err.details || {});
      setStatus({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Staff</h1>
        <p className="muted">Attendants can run gate entry and exit and view occupancy. They can't change settings or see reports.</p>
      </header>
      <div className="grid">
        <form className="card" onSubmit={onSubmit} noValidate>
          <h2>Add an attendant</h2>
          {status && <p className={`notice ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.text}</p>}
          <Field label="Full name" name="name" value={form.name} onChange={onChange} error={errors.name} />
          <Field label="Email" name="email" type="email" value={form.email} onChange={onChange} error={errors.email} />
          <Field label="Mobile number (optional)" name="phone" type="tel" value={form.phone} onChange={onChange} error={errors.phone} />
          <Field label="Temporary password" name="password" type="password" autoComplete="new-password"
            hint="At least 8 characters, with a letter and a number. Share it securely; they can change it from their profile."
            value={form.password} onChange={onChange} error={errors.password} />
          <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create attendant"}</button>
        </form>

        <section className="card">
          <h2>Attendants</h2>
          {!attendants ? <p className="muted">Loading…</p>
            : attendants.length === 0 ? <p className="muted">No attendants yet.</p>
              : (
                <ul className="staff-list">
                  {attendants.map((a) => (
                    <li key={a.id}>
                      <strong>{a.name}</strong>
                      <span className="muted">{a.email}{a.phone ? ` · ${a.phone}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
        </section>
      </div>
    </main>
  );
}
