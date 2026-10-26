import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
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
import "./styles.css";

function NavBar() {
  const { user, logout } = useAuth();
  return (
    <nav className="nav">
      <Link to="/" className="brand"><span className="brand-mark">P</span> <span className="brand-name">Vehicle Parking System</span></Link>
      {user ? (
        <div className="nav-actions">
          {user.role === "DRIVER" && <Link to="/search">Find parking</Link>}
          {user.role === "DRIVER" && <Link to="/bookings">My bookings</Link>}
          {user.role !== "DRIVER" && <Link to="/gate">Gate</Link>}
          {user.role === "ADMIN" && <Link to="/admin/staff">Staff</Link>}
          {user.role === "ADMIN" && <Link to="/admin/transactions">Payments</Link>}
          {user.role === "ADMIN" && <Link to="/admin/security">Security</Link>}
          <Link to="/profile">My profile</Link>
          <button className="btn link" onClick={logout}>Log out</button>
        </div>
      ) : (
        <div className="nav-actions">
          <Link to="/login">Log in</Link>
          <Link to="/register" className="btn primary small">Register</Link>
        </div>
      )}
    </nav>
  );
}

function App() {
  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/search" element={<RequireAuth roles={["DRIVER"]}><Search /></RequireAuth>} />
        <Route path="/bookings" element={<RequireAuth roles={["DRIVER"]}><Bookings /></RequireAuth>} />
        <Route path="/receipts/:id" element={<RequireAuth><ReceiptPage /></RequireAuth>} />
        <Route path="/gate" element={<RequireAuth roles={["ATTENDANT", "ADMIN"]}><Gate /></RequireAuth>} />
        <Route path="/admin/staff" element={<RequireAuth roles={["ADMIN"]}><Staff /></RequireAuth>} />
        <Route path="/admin/transactions" element={<RequireAuth roles={["ADMIN"]}><Transactions /></RequireAuth>} />
        <Route path="/admin/security" element={<RequireAuth roles={["ADMIN"]}><Security /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/profile" replace />} />
      </Routes>
    </>
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
