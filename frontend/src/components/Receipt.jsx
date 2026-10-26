import { Fragment } from "react";
import { formatDuration, formatMoney } from "../api";
import { formatDay, formatTime } from "../time";

const METHOD = { AT_GATE: "Card at gate", ONLINE: "Online" };

// Exit receipt (VPS-F-013): what the stay cost and how it was paid. Printable (see styles.css).
export default function Receipt({ receipt, onPrint }) {
  const tz = receipt.timezone;
  const when = (iso) => `${formatDay(iso, tz)}, ${formatTime(iso, tz)}`;
  return (
    <div className="receipt printable">
      <div className="receipt-head">
        <div>
          <p className="ticket-title">Parking receipt · {receipt.facilityName}</p>
          <p className="receipt-number">{receipt.number}</p>
        </div>
        <p className="fee-amount">{formatMoney(receipt.amount)}</p>
      </div>
      <dl>
        <dt>Vehicle</dt><dd><span className="plate">{receipt.plateNumber}</span></dd>
        <dt>Slot</dt><dd>{receipt.slotNumber} <span className="muted">{receipt.zoneName}</span></dd>
        <dt>Entered</dt><dd>{when(receipt.entryTime)}</dd>
        <dt>Left</dt><dd>{when(receipt.exitTime)}</dd>
        <dt>Duration</dt><dd>{formatDuration(receipt.duration)}</dd>
        <dt>Charge</dt><dd>{receipt.chargedHours} h × {formatMoney(receipt.ratePerHour)}</dd>
        {receipt.payments.map((p) => (
          <Fragment key={p.gatewayRef}>
            <dt>Paid</dt><dd>{formatMoney(p.amount)} · {METHOD[p.method] ?? p.method} <span className="muted small">ref {p.gatewayRef}</span></dd>
          </Fragment>
        ))}
      </dl>
      {onPrint && <button type="button" className="btn small no-print" onClick={onPrint}>Print receipt</button>}
    </div>
  );
}
