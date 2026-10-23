import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { VEHICLE_TYPES } from "../api";
import Field from "../components/Field";

const emptyVehicle = { plateNumber: "", vehicleType: "CAR" };

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [vehicles, setVehicles] = useState([{ ...emptyVehicle }]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const setVehicle = (i, patch) => setVehicles(vehicles.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setErrors({ confirm: "Passwords don't match" });

    setBusy(true);
    setErrors({});
    try {
      const { confirm, ...details } = form;
      // blank rows are skipped; remember which row each sent vehicle came from to place its errors
      const rows = vehicles.flatMap((v, i) => (v.plateNumber.trim() ? [i] : []));
      try {
        await register({ ...details, vehicles: rows.map((i) => vehicles[i]) });
      } catch (err) {
        err.details = Object.fromEntries(Object.entries(err.details).map(([k, msg]) =>
          [k.replace(/^vehicles\[(\d+)\]/, (_, n) => `vehicles[${rows[n]}]`), msg]));
        throw err;
      }
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(err.message);
      setErrors(err.details || {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card wide" onSubmit={onSubmit} noValidate>
        <h1>Create a driver account</h1>
        <p className="muted">Register once to search for parking and reserve slots online.</p>
        {error && <p className="notice error" role="alert">{error}</p>}

        <Field label="Full name" name="name" autoComplete="name" required value={form.name} onChange={onChange} error={errors.name} />
        <div className="row">
          <Field label="Email" name="email" type="email" autoComplete="email" required
            value={form.email} onChange={onChange} error={errors.email} />
          <Field label="Mobile number" name="phone" type="tel" autoComplete="tel" required placeholder="98765 43210"
            value={form.phone} onChange={onChange} error={errors.phone} />
        </div>
        <div className="row">
          <Field label="Password" name="password" type="password" autoComplete="new-password" required
            hint="At least 8 characters, with a letter and a number"
            value={form.password} onChange={onChange} error={errors.password} />
          <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required
            value={form.confirm} onChange={onChange} error={errors.confirm} />
        </div>

        <fieldset>
          <legend>Your vehicles <span className="muted">(optional — you can add them later)</span></legend>
          {errors.vehicles && <p className="field-error">{errors.vehicles}</p>}
          {vehicles.map((v, i) => (
            <div className="vehicle-row" key={i}>
              <Field label="Number plate" name={`plate-${i}`} placeholder="KA01AB1234" value={v.plateNumber}
                onChange={(e) => setVehicle(i, { plateNumber: e.target.value })}
                error={errors[`vehicles[${i}].plateNumber`]} />
              <div className="field">
                <label htmlFor={`type-${i}`}>Type</label>
                <select id={`type-${i}`} value={v.vehicleType} onChange={(e) => setVehicle(i, { vehicleType: e.target.value })}>
                  {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {vehicles.length > 1 && (
                <button type="button" className="btn link" onClick={() => setVehicles(vehicles.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {vehicles.length < 5 && (
            <button type="button" className="btn link" onClick={() => setVehicles([...vehicles, { ...emptyVehicle }])}>
              + Add another vehicle
            </button>
          )}
        </fieldset>

        <button className="btn primary block" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        <p className="muted center">Already registered? <Link to="/login">Log in</Link></p>
      </form>
    </main>
  );
}
