import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import Receipt from "../components/Receipt";

// A single receipt, e.g. from the driver's parking history; can be printed or saved as PDF.
export default function ReceiptPage() {
  const { id } = useParams();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.receipt(id).then(setReceipt).catch((err) => setError(err.message)); }, [id]);

  return (
    <main className="page narrow">
      <p className="no-print"><Link to="/bookings">← My bookings</Link></p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!receipt && !error && <p className="muted">Loading…</p>}
      {receipt && <div className="card"><Receipt receipt={receipt} onPrint={() => window.print()} /></div>}
    </main>
  );
}
