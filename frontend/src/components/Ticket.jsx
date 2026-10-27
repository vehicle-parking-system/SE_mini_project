import QrCode from "./QrCode";
import { formatDuration, formatMoney } from "../api";
import { formatDay, formatTime } from "../time";

// Entry ticket (VPS-F-004): proof of entry with the QR code to scan at the exit gate.
// Printable: when printing, only `.printable` content is shown (see styles.css).
export default function Ticket({ session, facilityName, timezone, onPrint }) {
  return (
    <div className="ticket printable">
      <div className="ticket-details">
        <p className="ticket-title">Entry ticket{facilityName && ` · ${facilityName}`}</p>
        <p className="ticket-slot">Slot <strong>{session.slotNumber}</strong> <span className="muted">{session.zoneName}</span></p>
        <dl>
          <dt>Vehicle</dt><dd><span className="plate">{session.plateNumber}</span></dd>
          <dt>Entered</dt><dd>{formatDay(session.entryTime, timezone)}, {formatTime(session.entryTime, timezone)}</dd>
          <dt>Gate</dt><dd>{session.gateName}</dd>
          {session.fee && (
            <><dt>So far</dt><dd>{formatMoney(session.fee.total)} for {formatDuration(session.fee.duration)} <span className="muted">({formatMoney(session.ratePerHour)}/h{session.fee.paid > 0 && `, ${formatMoney(session.fee.paid)} paid`})</span></dd></>
          )}
        </dl>
        <p className="muted small">Scan this ticket at the exit gate.</p>
        {onPrint && <button type="button" className="btn small no-print" onClick={onPrint}>Print ticket</button>}
      </div>
      {session.ticketQr && <QrCode value={session.ticketQr} label={`Exit ticket for ${session.plateNumber}`} size={140} />}
    </div>
  );
}
