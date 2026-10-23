import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import Field from "../components/Field";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.email, form.password);
      navigate(location.state?.from || "/profile", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>Log in</h1>
        <p className="muted">Manage your profile, find parking and book a slot.</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        <Field label="Email" name="email" type="email" autoComplete="email" required value={form.email} onChange={onChange} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required
          value={form.password} onChange={onChange} />
        <button className="btn primary block" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        <p className="muted center">New here? <Link to="/register">Create a driver account</Link></p>
      </form>
    </main>
  );
}
