import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, GuestOnly, RequireAuth, useAuth } from "./auth";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Profile from "./pages/Profile";
import Staff from "./pages/Staff";
import Security from "./pages/Security";
import Search from "./pages/Search";
import Bookings from "./pages/Bookings";
import Gate from "./pages/Gate";
import ReceiptPage from "./pages/ReceiptPage";
import Transactions from "./pages/Transactions";
import Facilities from "./pages/Facilities";
import Monitor from "./pages/Monitor";
import Reports from "./pages/Reports";
import Logs from "./pages/Logs";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./styles.css";

// Sidebar links by role. Groups follow who does the work: drivers park, staff run the gates, admins set things up.
const NAV = [
  { title: "Parking", roles: ["DRIVER"], links: [["/search", "Find parking"], ["/bookings", "My bookings"]] },
  { title: "Operations", roles: ["ATTENDANT", "ADMIN"], links: [["/gate", "Gate"], ["/monitor", "Monitor"]] },
  { title: "Admin", roles: ["ADMIN"], links: [["/admin/facilities", "Facilities"], ["/admin/staff", "Staff"],
    ["/admin/transactions", "Payments"], ["/admin/reports", "Reports"], ["/admin/security", "Security"], ["/admin/logs", "Logs"]] },
];
const ROLE_NAMES = { DRIVER: "Driver", ATTENDANT: "Attendant", ADMIN: "Admin" };

function Brand() {
  return <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">P</span><span className="brand-name">Vehicle Parking</span></Link>;
}

function Sidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="sidebar-top">
        <Brand />
        <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="side-nav" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <nav id="side-nav" className="side-nav" aria-label="Main">
        {NAV.filter((g) => g.roles.includes(user.role)).map((g) => (
          <div className="nav-group" key={g.title}>
            <p className="nav-group-title">{g.title}</p>
            {g.links.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
          </div>
        ))}
        <div className="nav-account">
          <NavLink to="/profile" className="account-link">
            <span className="avatar" aria-hidden="true">{user.name?.trim()[0]?.toUpperCase() || "?"}</span>
            <span><span className="account-name">{user.name}</span><span className="account-role">{ROLE_NAMES[user.role]}</span></span>
          </NavLink>
          <button type="button" className="logout" onClick={logout}>Log out</button>
        </div>
      </nav>
    </aside>
  );
}

// Painted parking bays seen from above: the picture beside the login and registration forms.
function BayArt() {
  const bays = [1, 0, 1, 1, 0, 2, 1, 0];
  return (
    <svg className="bay-art" viewBox="0 0 400 260" aria-hidden="true" focusable="false">
      {bays.map((b, i) => {
        const x = 20 + i * 46;
        return (
          <g key={i}>
            <line x1={x} y1="20" x2={x} y2="140" className="bay-line" />
            <text x={x + 23} y="132" className="bay-number">{String(i + 1).padStart(2, "0")}</text>
            {b === 1 && <rect x={x + 8} y="34" width="30" height="72" rx="7" className="bay-car" />}
            {b === 2 && <rect x={x + 8} y="34" width="30" height="72" rx="7" className="bay-booked" />}
          </g>
        );
      })}
      <line x1="388" y1="20" x2="388" y2="140" className="bay-line" />
      <line x1="20" y1="196" x2="388" y2="196" className="lane-line" />
      <path d="M300 228 h44 m-14 -12 l14 12 l-14 12" className="lane-arrow" />
    </svg>
  );
}

function AuthLayout({ children }) {
  return (
    <div className="auth-layout">
      <section className="auth-aside">
        <Brand />
        <div className="auth-pitch">
          <h2>Find a bay, book it, drive straight in.</h2>
          <p>See which slots are free before you leave, pay online and show your QR code at the gate.</p>
        </div>
        <BayArt />
      </section>
      {children}
    </div>
  );
}

function App() {
  const { user } = useAuth();
  return (
    <div className={user ? "app-shell" : "app-guest"}>
      {user && <Sidebar />}
      <div className="shell-content">
      <Routes>
        <Route path="/login" element={<GuestOnly><AuthLayout><Login /></AuthLayout></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><AuthLayout><Register /></AuthLayout></GuestOnly>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/search" element={<RequireAuth roles={["DRIVER"]}><Search /></RequireAuth>} />
        <Route path="/bookings" element={<RequireAuth roles={["DRIVER"]}><Bookings /></RequireAuth>} />
        <Route path="/receipts/:id" element={<RequireAuth><ReceiptPage /></RequireAuth>} />
        <Route path="/gate" element={<RequireAuth roles={["ATTENDANT", "ADMIN"]}><Gate /></RequireAuth>} />
        <Route path="/monitor" element={<RequireAuth roles={["ATTENDANT", "ADMIN"]}><Monitor /></RequireAuth>} />
        <Route path="/admin/facilities" element={<RequireAuth roles={["ADMIN"]}><Facilities /></RequireAuth>} />
        <Route path="/admin/staff" element={<RequireAuth roles={["ADMIN"]}><Staff /></RequireAuth>} />
        <Route path="/admin/transactions" element={<RequireAuth roles={["ADMIN"]}><Transactions /></RequireAuth>} />
        <Route path="/admin/reports" element={<RequireAuth roles={["ADMIN"]}><Reports /></RequireAuth>} />
        <Route path="/admin/logs" element={<RequireAuth roles={["ADMIN"]}><Logs /></RequireAuth>} />
        <Route path="/admin/security" element={<RequireAuth roles={["ADMIN"]}><Security /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/profile" replace />} />
      </Routes>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
