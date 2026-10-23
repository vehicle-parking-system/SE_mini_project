import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, GuestOnly, RequireAuth, useAuth } from "./auth";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Profile from "./pages/Profile";
import Staff from "./pages/Staff";
import Security from "./pages/Security";
import "./styles.css";

function NavBar() {
  const { user, logout } = useAuth();
  return (
    <nav className="nav">
      <Link to="/" className="brand"><span className="brand-mark">P</span> Vehicle Parking System</Link>
      {user ? (
        <div className="nav-actions">
          {user.role === "ADMIN" && <Link to="/admin/staff">Staff</Link>}
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
        <Route path="/admin/staff" element={<RequireAuth roles={["ADMIN"]}><Staff /></RequireAuth>} />
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
