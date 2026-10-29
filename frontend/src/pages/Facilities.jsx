import { useCallback, useEffect, useState } from "react";
import { api, formatMoney, VEHICLE_TYPES } from "../api";
import Field from "../components/Field";

const TYPE_LABEL = Object.fromEntries(VEHICLE_TYPES.map((t) => [t.value, t.label]));
const newFacility = { name: "", address: "", openTime: "06:00", closeTime: "22:00", zoneName: "Zone A" };

// "A-", 1, 3 -> ["A-01", "A-02", "A-03"]
const slotNumbers = (prefix, from, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(from + i).padStart(2, "0")}`);

function TypeSelect({ id, value, onChange }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
    </select>
  );
}

// Opening hours, booking grace period and refund cut-off of one facility
function SettingsForm({ facility, onSaved }) {
  const pick = (f) => ({ name: f.name, address: f.address ?? "", openTime: f.openTime, closeTime: f.closeTime,
    reservationGraceMinutes: String(f.reservationGraceMinutes), refundCutoffMinutes: String(f.refundCutoffMinutes) });
  const [form, setForm] = useState(() => pick(facility));
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  useEffect(() => setForm(pick(facility)), [facility]);
  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setErrors({});
    setStatus(null);
    try {
      await api.updateFacility(facility.id, { ...form, address: form.address || null,
        reservationGraceMinutes: Number(form.reservationGraceMinutes), refundCutoffMinutes: Number(form.refundCutoffMinutes) });
      setStatus({ kind: "success", text: "Saved" });
      onSaved();
    } catch (err) {
      setErrors(err.details || {});
      setStatus({ kind: "error", text: err.message });
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>Settings</h2>
      {status && <p className={`notice ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.text}</p>}
      <Field label="Name" name="name" value={form.name} onChange={onChange} error={errors.name} />
      <Field label="Address" name="address" value={form.address} onChange={onChange} error={errors.address} />
      <div className="row">
        <Field label="Opens" name="openTime" type="time" value={form.openTime} onChange={onChange} error={errors.openTime} />
        <Field label="Closes" name="closeTime" type="time" value={form.closeTime} onChange={onChange} error={errors.closeTime} />
      </div>
      <div className="row">
        <Field label="Booking grace (min)" name="reservationGraceMinutes" type="number" min="0" value={form.reservationGraceMinutes}
          onChange={onChange} error={errors.reservationGraceMinutes} hint="A booking is held this long after its start" />
        <Field label="Free cancellation (min)" name="refundCutoffMinutes" type="number" min="0" value={form.refundCutoffMinutes}
          onChange={onChange} error={errors.refundCutoffMinutes} hint="Full refund if cancelled this long before the start" />
      </div>
      <button className="btn primary">Save settings</button>
    </form>
  );
}

// Hourly rates per vehicle type: facility-wide, or for one zone (a zone's own rate wins)
function RatesCard({ facility, onSaved }) {
  const [form, setForm] = useState({ zoneId: "", vehicleType: "CAR", ratePerHour: "" });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  const zoneName = (id) => facility.zones.find((z) => z.id === id)?.name ?? "All zones";

  async function save(rate) {
    setErrors({});
    setStatus(null);
    try {
      const { created } = await api.setRate({ facilityId: facility.id, ...rate });
      setStatus({ kind: "success", text: `${created ? "Rate added" : "Rate updated"}. It applies to vehicles that enter from now on.` });
      setForm({ ...form, ratePerHour: "" });
      onSaved();
    } catch (err) {
      setErrors(err.details || {});
      setStatus({ kind: "error", text: err.message });
    }
  }
  async function remove(rate) {
    try {
      await api.deleteRate(rate.id);
      onSaved();
    } catch (err) {
      setStatus({ kind: "error", text: err.message });
    }
  }

  return (
    <section className="card">
      <h2>Pricing</h2>
      {status && <p className={`notice ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.text}</p>}
      {facility.rates.length === 0 ? <p className="muted">No rates yet: parking here is free.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Applies to</th><th>Vehicle</th><th>Per hour</th><th /></tr></thead>
            <tbody>
              {facility.rates.map((r) => (
                <tr key={r.id}>
                  <td>{zoneName(r.zoneId)}</td>
                  <td>{TYPE_LABEL[r.vehicleType]}</td>
                  <td>{formatMoney(r.ratePerHour)}</td>
                  <td><button type="button" className="btn link danger" onClick={() => remove(r)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="rate-form" noValidate onSubmit={(e) => {
        e.preventDefault();
        save({ zoneId: form.zoneId || null, vehicleType: form.vehicleType, ratePerHour: Number(form.ratePerHour) });
      }}>
        <div className="field">
          <label htmlFor="rateZone">Applies to</label>
          <select id="rateZone" value={form.zoneId} onChange={(e) => setForm({ ...form, zoneId: e.target.value })}>
            <option value="">All zones</option>
            {facility.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rateType">Vehicle</label>
          <TypeSelect id="rateType" value={form.vehicleType} onChange={(vehicleType) => setForm({ ...form, vehicleType })} />
        </div>
        <Field label="₹ per hour" name="ratePerHour" type="number" min="0" step="0.01" value={form.ratePerHour}
          onChange={(e) => setForm({ ...form, ratePerHour: e.target.value })} error={errors.ratePerHour} />
        <button className="btn">Set rate</button>
      </form>
    </section>
  );
}

// Adds a numbered run of slots to a zone, e.g. A-04 … A-10
function AddSlots({ zone, onSaved }) {
  const [form, setForm] = useState({ prefix: "", from: "1", count: "1", vehicleType: "CAR", distance: "0", step: "5" });
  const [error, setError] = useState(null);
  const set = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const numbers = slotNumbers(form.prefix, Number(form.from), Math.max(0, Number(form.count)));
    try {
      await api.addSlots(zone.id, numbers.map((number, i) => ({ number, vehicleType: form.vehicleType,
        distance: Number(form.distance) + i * Number(form.step) })));
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="add-slots" onSubmit={onSubmit} noValidate>
      <Field label="Prefix" name="prefix" value={form.prefix} onChange={set} placeholder="A-" />
      <Field label="From" name="from" type="number" min="0" value={form.from} onChange={set} />
      <Field label="How many" name="count" type="number" min="1" max="500" value={form.count} onChange={set} />
      <div className="field">
        <label htmlFor={`type-${zone.id}`}>Vehicle</label>
        <TypeSelect id={`type-${zone.id}`} value={form.vehicleType} onChange={(vehicleType) => setForm({ ...form, vehicleType })} />
      </div>
      <Field label="Distance (m)" name="distance" type="number" min="0" value={form.distance} onChange={set}
        hint={`then +${form.step} m each`} />
      <button className="btn">Add slots</button>
      {error && <p className="notice error" role="alert">{error}</p>}
    </form>
  );
}

function ZoneCard({ zone, onSaved }) {
  const [error, setError] = useState(null);
  async function toggle(slot) {
    setError(null);
    try {
      await api.updateSlot(slot.slotId, { active: !slot.active });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }
  const active = zone.slots.filter((s) => s.active).length;

  return (
    <section className="card">
      <div className="card-header">
        <h2>{zone.name}</h2>
        <span className="muted">{active} of {zone.slots.length} slots in use</span>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {zone.slots.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Slot</th><th>Vehicle</th><th>Distance</th><th>Now</th><th /></tr></thead>
            <tbody>
              {zone.slots.map((s) => (
                <tr key={s.slotId} className={s.active ? "" : "inactive-row"}>
                  <td><strong>{s.number}</strong></td>
                  <td>{TYPE_LABEL[s.vehicleType]}</td>
                  <td>{s.distance} m</td>
                  <td><span className={`status-badge ${s.status}`}>{s.status.toLowerCase()}</span></td>
                  <td>
                    <button type="button" className={`btn link${s.active ? " danger" : ""}`} onClick={() => toggle(s)}>
                      {s.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddSlots zone={zone} onSaved={onSaved} />
    </section>
  );
}

// A new zone or gate for the selected facility
function AddToFacility({ facility, onSaved }) {
  const [zoneName, setZoneName] = useState("");
  const [gate, setGate] = useState({ name: "", type: "ENTRY" });
  const [status, setStatus] = useState(null);

  async function run(action, done) {
    setStatus(null);
    try {
      await action();
      done();
      onSaved();
    } catch (err) {
      setStatus({ kind: "error", text: err.message });
    }
  }

  return (
    <section className="card">
      <h2>Zones and gates</h2>
      {status && <p className={`notice ${status.kind}`} role="alert">{status.text}</p>}
      <form className="inline-form" noValidate onSubmit={(e) => {
        e.preventDefault();
        run(() => api.addZone(facility.id, { name: zoneName }), () => setZoneName(""));
      }}>
        <Field label="New zone" name="zoneName" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Basement 1" />
        <button className="btn">Add zone</button>
      </form>
      <p className="muted small">Gates: {facility.gates.map((g) => `${g.name} (${g.type.toLowerCase()})`).join(", ") || "none"}</p>
      <form className="inline-form" noValidate onSubmit={(e) => {
        e.preventDefault();
        run(() => api.addGate(facility.id, gate), () => setGate({ ...gate, name: "" }));
      }}>
        <Field label="New gate" name="gateName" value={gate.name} onChange={(e) => setGate({ ...gate, name: e.target.value })} placeholder="Entry 2" />
        <div className="field">
          <label htmlFor="gateType">Type</label>
          <select id="gateType" value={gate.type} onChange={(e) => setGate({ ...gate, type: e.target.value })}>
            <option value="ENTRY">Entry</option>
            <option value="EXIT">Exit</option>
          </select>
        </div>
        <button className="btn">Add gate</button>
      </form>
    </section>
  );
}

function NewFacilityForm({ onCreated }) {
  const [form, setForm] = useState(newFacility);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setErrors({});
    setError(null);
    try {
      const { facility } = await api.createFacility({ name: form.name, address: form.address || undefined,
        openTime: form.openTime, closeTime: form.closeTime, zones: form.zoneName ? [{ name: form.zoneName, slots: [] }] : [] });
      setForm(newFacility);
      onCreated(facility);
    } catch (err) {
      setErrors(err.details || {});
      setError(err.message);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>New facility</h2>
      <p className="muted small">It gets one entry and one exit gate. Add slots and rates once it exists.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <Field label="Name" name="name" value={form.name} onChange={onChange} error={errors.name} />
      <Field label="Address (optional)" name="address" value={form.address} onChange={onChange} error={errors.address} />
      <div className="row">
        <Field label="Opens" name="openTime" type="time" value={form.openTime} onChange={onChange} error={errors.openTime} />
        <Field label="Closes" name="closeTime" type="time" value={form.closeTime} onChange={onChange} error={errors.closeTime} />
      </div>
      <Field label="First zone" name="zoneName" value={form.zoneName} onChange={onChange} error={errors["zones[0].name"]} />
      <button className="btn primary">Create facility</button>
    </form>
  );
}

// Admin only: lot, zone, slot and pricing configuration (VPS-F-040, VPS-F-041)
export default function Facilities() {
  const [facilities, setFacilities] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(() => api.adminFacilities()
    .then(({ facilities: list }) => {
      setFacilities(list);
      setSelectedId((id) => (list.some((f) => f.id === id) ? id : list[0]?.id ?? "new"));
    })
    .catch((err) => setError(err.message)), []);
  useEffect(() => { load(); }, [load]);

  if (error && !facilities) return <main className="page"><p className="notice error" role="alert">{error}</p></main>;
  if (!facilities) return <main className="page"><p className="muted">Loading…</p></main>;
  const facility = facilities.find((f) => f.id === selectedId);

  return (
    <main className="page">
      <header className="page-header gate-header">
        <div>
          <h1>Facilities</h1>
          <p className="muted">Lots, zones, slots and hourly rates. Rate changes apply to vehicles that enter afterwards.</p>
        </div>
        <div className="field facility-pick">
          <label htmlFor="facilityPick">Facility</label>
          <select id="facilityPick" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="new">+ New facility</option>
          </select>
        </div>
      </header>
      {!facility ? (
        <div className="grid"><NewFacilityForm onCreated={(f) => { setSelectedId(f.id); load(); }} /></div>
      ) : (
        <div className="grid">
          <div className="stack">
            <SettingsForm facility={facility} onSaved={load} />
            <RatesCard facility={facility} onSaved={load} />
            <AddToFacility facility={facility} onSaved={load} />
          </div>
          <div className="stack">
            {facility.zones.length === 0 ? <div className="card"><p className="muted">No zones yet.</p></div>
              : facility.zones.map((z) => <ZoneCard key={z.id} zone={z} onSaved={load} />)}
          </div>
        </div>
      )}
    </main>
  );
}
