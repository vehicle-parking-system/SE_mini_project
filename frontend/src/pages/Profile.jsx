import { useEffect, useState } from "react";
import { api, ROLE_LABELS, VEHICLE_TYPES } from "../api";
import { useAuth } from "../auth";
import Field from "../components/Field";

const typeLabel = (value) => VEHICLE_TYPES.find((t) => t.value === value)?.label ?? value;

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null); // {kind: "success"|"error", text}
  const [busy, setBusy] = useState(false);
  const onChange = (e) => setValues({ ...values, [e.target.name]: e.target.value });

  // Runs action(); shows success text or the API error (and its per-field details).
  async function submit(action, successText) {
    setBusy(true);
    setStatus(null);
    setErrors({});
    try {
      await action();
      if (successText) setStatus({ kind: "success", text: successText });
      return true;
    } catch (err) {
      setErrors(err.details || {});
      setStatus({ kind: "error", text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { values, setValues, errors, status, busy, onChange, submit };
}

const Status = ({ status }) => status && (
  <p className={`notice ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.text}</p>
);

function DetailsCard({ user, onSaved }) {
  const form = useForm({ name: user.name, phone: user.phone ?? "" });
  const { values } = form;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async () => onSaved(await api.updateMe(values)), "Profile updated");
  };

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>Personal details</h2>
      <Status status={form.status} />
      <Field label="Full name" name="name" value={values.name} onChange={form.onChange} error={form.errors.name} />
      <Field label="Email" name="email" value={user.email} disabled hint="Your email is your login and can't be changed" />
      <Field label="Mobile number" name="phone" type="tel" value={values.phone} onChange={form.onChange} error={form.errors.phone} />
      <button className="btn primary" disabled={form.busy}>{form.busy ? "Saving…" : "Save changes"}</button>
    </form>
  );
}

function VehiclesCard({ vehicles, onChanged }) {
  const form = useForm({ plateNumber: "", vehicleType: "CAR" });
  const [removing, setRemoving] = useState(null);

  const onAdd = async (e) => {
    e.preventDefault();
    const ok = await form.submit(async () => { await api.addVehicle(form.values); await onChanged(); }, "Vehicle added");
    if (ok) form.setValues({ ...form.values, plateNumber: "" });
  };

  const onRemove = async (v) => {
    if (!window.confirm(`Remove ${v.plateNumber} from your account?`)) return;
    setRemoving(v.id);
    await form.submit(async () => { await api.removeVehicle(v.id); await onChanged(); }, `${v.plateNumber} removed`);
    setRemoving(null);
  };

  return (
    <section className="card">
      <h2>My vehicles</h2>
      <Status status={form.status} />
      {vehicles.length === 0
        ? <p className="muted">No vehicles yet. Add one to start reserving slots.</p>
        : (
          <ul className="vehicle-list">
            {vehicles.map((v) => (
              <li key={v.id}>
                <span className="plate">{v.plateNumber}</span>
                <span className="muted">{typeLabel(v.vehicleType)}</span>
                <button className="btn link danger" disabled={removing === v.id} onClick={() => onRemove(v)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      {vehicles.length < 5 && (
        <form className="vehicle-row add-vehicle" onSubmit={onAdd} noValidate>
          <Field label="Number plate" name="plateNumber" placeholder="KA01AB1234" value={form.values.plateNumber}
            onChange={form.onChange} error={form.errors["vehicle.plateNumber"]} />
          <div className="field">
            <label htmlFor="vehicleType">Type</label>
            <select id="vehicleType" name="vehicleType" value={form.values.vehicleType} onChange={form.onChange}>
              {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <button className="btn" disabled={form.busy}>Add vehicle</button>
        </form>
      )}
    </section>
  );
}

function PasswordCard() {
  const form = useForm({ currentPassword: "", newPassword: "", confirm: "" });
  const { values } = form;

  const onSubmit = async (e) => {
    e.preventDefault();
    const ok = await form.submit(async () => {
      if (values.newPassword !== values.confirm) {
        throw Object.assign(new Error("Passwords don't match"), { details: { confirm: "Passwords don't match" } });
      }
      await api.changePassword(values.currentPassword, values.newPassword);
    }, "Password changed");
    if (ok) form.setValues({ currentPassword: "", newPassword: "", confirm: "" });
  };

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>Change password</h2>
      <Status status={form.status} />
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password"
        value={values.currentPassword} onChange={form.onChange} error={form.errors.currentPassword} />
      <Field label="New password" name="newPassword" type="password" autoComplete="new-password"
        hint="At least 8 characters, with a letter and a number"
        value={values.newPassword} onChange={form.onChange} error={form.errors.newPassword} />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password"
        value={values.confirm} onChange={form.onChange} error={form.errors.confirm} />
      <button className="btn" disabled={form.busy}>Change password</button>
    </form>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const [vehicles, setVehicles] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    const data = await api.me();
    setUser(data.user);
    setVehicles(data.vehicles);
  };

  useEffect(() => { load().catch((err) => setError(err.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page">
      <header className="page-header">
        <h1>Hello, {user.name.split(" ")[0]} <span className="role-badge">{ROLE_LABELS[user.role]}</span></h1>
        <p className="muted">
          {user.role === "DRIVER"
            ? "Keep your details and vehicles up to date so bookings and gate entry go smoothly."
            : "Keep your account details up to date."}
        </p>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="grid">
        <DetailsCard user={user} onSaved={(data) => { setUser(data.user); setVehicles(data.vehicles); }} />
        {user.role === "DRIVER" && (vehicles
          ? <VehiclesCard vehicles={vehicles} onChanged={load} />
          : <section className="card muted">Loading vehicles…</section>)}
        <PasswordCard />
      </div>
    </main>
  );
}
