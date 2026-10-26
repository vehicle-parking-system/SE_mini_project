import { useEffect, useState } from "react";
import { api, formatMoney } from "../api";

const FILTERS = [["", "All"], ["PAYMENT", "Payments"], ["REFUND", "Refunds"]];
const METHOD = { AT_GATE: "At gate", ONLINE: "Online" };
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Admin only: the transaction log (VPS-F-032). Every payment and refund with the payment
// gateway's reference; card details are never held by this system.
export default function Transactions() {
  const [type, setType] = useState("");
  const [transactions, setTransactions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setTransactions(null);
    api.transactions(type ? { type } : {}).then((r) => setTransactions(r.transactions)).catch((err) => setError(err.message));
  }, [type]);

  const confirmed = (transactions ?? []).filter((t) => t.type === "PAYMENT" && t.status === "CONFIRMED").reduce((s, t) => s + t.amount, 0);
  const refunded = (transactions ?? []).filter((t) => t.type === "REFUND").reduce((s, t) => s + t.amount, 0);

  return (
    <main className="page">
      <header className="page-header">
        <h1>Payments</h1>
        <p className="muted">Every payment and refund, with the payment gateway&apos;s reference. Card details are never stored here.</p>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      <section className="card">
        <div className="card-header">
          <div className="segmented compact" role="radiogroup" aria-label="Show">
            {FILTERS.map(([value, label]) => (
              <button key={label} type="button" role="radio" aria-checked={type === value} className={type === value ? "active" : ""}
                onClick={() => setType(value)}>{label}</button>
            ))}
          </div>
          {transactions && <span className="muted">{formatMoney(confirmed)} received · {formatMoney(refunded)} refunded</span>}
        </div>
        {!transactions ? <p className="muted">Loading…</p>
          : transactions.length === 0 ? <p className="muted">No transactions yet.</p>
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>When</th><th>Type</th><th>For</th><th>Method</th><th>Amount</th><th>Status</th><th>Gateway ref</th></tr></thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.paymentId}>
                        <td>{when(t.createdAt)}</td>
                        <td>{t.type === "REFUND" ? "Refund" : "Payment"}</td>
                        <td className="muted">{t.reservationId ? "Booking" : "Parking"}</td>
                        <td>{METHOD[t.method] ?? t.method}</td>
                        <td>{t.type === "REFUND" ? "−" : ""}{formatMoney(t.amount)}</td>
                        <td><span className={`status-badge ${t.status}`}>{t.status.toLowerCase()}</span></td>
                        <td><code className="small">{t.gatewayRef}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </section>
    </main>
  );
}
