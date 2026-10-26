import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, formatMoney, RESERVATION_STATUS, SANDBOX_GATEWAY_TOKEN } from "../api";
import QrCode from "../components/QrCode";
import Ticket from "../components/Ticket";
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

// Pay the parking fee online before walking back to the car, so the exit barrier opens straight away.
function PayOnline({ session, onPaid }) {
  const [state, setState] = useState(null); // null | "paying" | {error}
  const fee = session.fee;
  if (!fee) return null;
  if (fee.paymentStatus === "PAID") {
    return <p className="notice success">Paid. You have a few minutes to drive out without paying more.</p>;
  }

  async function pay() {
    setState("paying");
    try {
      await api.pay({ sessionId: session.sessionId, method: "ONLINE", gatewayToken: SANDBOX_GATEWAY_TOKEN });
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const updated = (await api.mySessions()).sessions.find((s) => s.sessionId === session.sessionId);
        if (updated?.fee?.paymentStatus !== "PENDING") {
          onPaid(updated);
          setState(updated?.fee?.paymentStatus === "UNPAID" ? { error: "The payment was declined." } : null);
          return;
        }
      }
      setState({ error: "The payment is taking longer than usual. Check back in a minute." });
    } catch (err) {
      setState({ error: err.message });
    }
  }

  return (
    <div className="pay-online">
      {state?.error && <p className="notice error" role="alert">{state.error}</p>}
      <button className="btn primary" onClick={pay} disabled={state === "paying"}>
        {state === "paying" ? "Confirming payment…" : `Pay ${formatMoney(fee.amount)} now`}
      </button>
      <span className="muted small">Pay before you leave and the exit barrier opens straight away.</span>
    </div>
  );
}

// The driver's bookings. Active ones show the QR code to scan at the entry gate.
export default function Bookings() {
  const location = useLocation();
  const justBooked = location.state?.booked;
  const [bookings, setBookings] = useState(null);
  const [parked, setParked] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.myReservations().then(({ reservations }) => setBookings(reservations)).catch((err) => setError(err.message));
    api.mySessions().then(({ sessions }) => setParked(sessions.filter((s) => s.status === "ACTIVE"))).catch(() => {});
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
      {parked.length > 0 && (
        <section className="parked-now">
          <h2>Parked now</h2>
          {parked.map((s) => (
            <div className="card" key={s.sessionId}>
              <Ticket session={s} />
              <PayOnline session={s} onPaid={(updated) => setParked(parked.map((p) => (p.sessionId === updated.sessionId ? updated : p)))} />
            </div>
          ))}
        </section>
      )}
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
