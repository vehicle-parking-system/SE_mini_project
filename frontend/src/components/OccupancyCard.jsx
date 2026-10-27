import { VEHICLE_TYPES } from "../api";

const typeLabel = (value) => VEHICLE_TYPES.find((t) => t.value === value)?.label ?? value;
const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);

function Meter({ label, count }) {
  return (
    <li>
      <div className="meter-label">
        <span>{label}</span>
        <span className={count.full ? "danger-text" : "muted"}>
          {count.full ? "Full" : `${count.free} free`} · {count.occupied} parked{count.booked ? ` · ${count.booked} booked` : ""}
        </span>
      </div>
      <div className="meter" role="img" aria-label={`${label}: ${count.occupied} parked, ${count.booked} booked, ${count.free} free of ${count.capacity}`}>
        <span className="meter-occupied" style={{ width: `${pct(count.occupied, count.capacity)}%` }} />
        <span className="meter-booked" style={{ width: `${pct(count.booked, count.capacity)}%` }} />
      </div>
    </li>
  );
}

// Live occupancy (VPS-F-003, GET /api/occupancy/:facilityId): parked, booked for now and free per
// vehicle type, so the attendant sees "full" before a car arrives; with byZone, per zone too.
export default function OccupancyCard({ occupancy, title = "Occupancy", byZone = false }) {
  if (!occupancy) return <section className="card"><h2>{title}</h2><p className="muted">Loading…</p></section>;
  return (
    <section className="card occupancy">
      <div className="card-header">
        <h2>{title}</h2>
        {occupancy.full ? <span className="status-badge FAILED">Facility Full</span>
          : <span className="muted">{occupancy.free} of {occupancy.capacity} free</span>}
      </div>
      <ul className="meter-list">
        {occupancy.byVehicleType.map((t) => <Meter key={t.vehicleType} label={typeLabel(t.vehicleType)} count={t} />)}
      </ul>
      {byZone && occupancy.byZone.length > 1 && (
        <>
          <h3 className="meter-heading">By zone</h3>
          <ul className="meter-list">
            {occupancy.byZone.map((z) => <Meter key={z.zoneId} label={z.name} count={{ ...z, full: z.capacity > 0 && z.free === 0 }} />)}
          </ul>
        </>
      )}
    </section>
  );
}
