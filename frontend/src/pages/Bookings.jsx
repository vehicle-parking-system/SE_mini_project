import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, RESERVATION_STATUS } from "../api";
import QrCode from "../components/QrCode";
import { formatDay, formatTime } from "../time";

const ACTIVE = ["HELD", "CONFIRMED"];

function Booking({ booking, onCancelled, highlight }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const tz = booking.timezone;
  const status = RESERVATION_STATUS[booking.status] ?? { label: booking.status };
  const active = ACTIVE.includes(booking.status);

  async function cancel() {
    if (!window.confirm(`Cancel your booking for slot ${booking.slotNumber}?`)) return;
    setBusy(true);
    setError(null);
    try {
      onCancelled(await api.cancelReservation(booking.reservationId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`card booking${highlight ? " highlight" : ""}`}>
      <div className="booking-main">
        <div className="card-header">
          <h2>{booking.facilityName} · <span className="plate">{booking.slotNumber}</span></h2>
          <span className={`status-badge ${booking.status}`}>{status.label}</span>
        </div>
        <p className="booking-when">
          {formatDay(booking.startTime, tz)}, {formatTime(booking.startTime, tz)}–{formatTime(booking.endTime, tz)}
        </p>
        <p className="muted">
          {booking.zoneName} · {booking.plateNumber}
          {status.hint && <> · {status.hint}</>}
        </p>
        {booking.status === "HELD" && (
          <p className="muted small">
            Arrive by {formatTime(booking.holdExpiresAt, tz)} or the slot is released.
          </p>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
        {active && <button className="btn link danger" onClick={cancel} disabled={busy}>{busy ? "Cancelling…" : "Cancel booking"}</button>}
      </div>
      {active && booking.qrCode && (
        <QrCode value={booking.qrCode} label={`Entry code for booking ${booking.slotNumber}`} />
      )}
    </li>
  );
}

// The driver's bookings. Active ones show the QR code to scan at the entry gate.
export default function Bookings() {
  const location = useLocation();
  const justBooked = location.state?.booked;
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.myReservations().then(({ reservations }) => setBookings(reservations)).catch((err) => setError(err.message));
  }, []);

  const replace = (updated) => setBookings(bookings.map((b) => (b.reservationId === updated.reservationId ? updated : b)));

  if (error) return <main className="page"><p className="notice error" role="alert">{error}</p></main>;
  if (!bookings) return <main className="page"><p className="muted">Loading…</p></main>;

  const upcoming = bookings.filter((b) => ACTIVE.includes(b.status)).reverse(); // soonest first
  const past = bookings.filter((b) => !ACTIVE.includes(b.status));

  return (
    <main className="page">
      <header className="page-header">
        <h1>My bookings</h1>
        <p className="muted">Show the QR code at the entry gate. The slot is kept for you until the grace period after your start time.</p>
      </header>
      {justBooked && (
        <p className="notice success" role="status">Slot {justBooked.slotNumber} is booked for you.</p>
      )}

      {upcoming.length === 0 ? (
        <div className="card">
          <p className="muted">You have no upcoming bookings. <Link to="/search">Find parking</Link></p>
        </div>
      ) : (
        <ul className="booking-list">
          {upcoming.map((b) => (
            <Booking key={b.reservationId} booking={b} onCancelled={replace}
              highlight={b.reservationId === justBooked?.reservationId} />
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <section className="past-bookings">
          <h2>Past and cancelled</h2>
          <ul className="booking-list">
            {past.map((b) => <Booking key={b.reservationId} booking={b} onCancelled={replace} />)}
          </ul>
        </section>
      )}
    </main>
  );
}
