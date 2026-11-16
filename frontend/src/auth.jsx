import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, setToken } from "./api";

const TOKEN_KEY = "vps.token";
const AuthContext = createContext(null);

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // True after the user logs out on purpose. The page they were on belongs to that session, so the
  // next login must not be sent back to it (VPS-48); an expired session still returns to its page.
  const loggedOut = useRef(false);

  const startSession = useCallback((token, sessionUser) => {
    loggedOut.current = false;
    setToken(token);
    writeToken(token);
    setUser(sessionUser);
  }, []);

  const endSession = useCallback((byUser) => {
    loggedOut.current = byUser;
    setToken(null);
    writeToken(null);
    setUser(null);
  }, []);

  const logout = useCallback(() => endSession(true), [endSession]);

  // Restore the session from a saved token; drop it if the server no longer accepts it.
  useEffect(() => {
    const token = readToken();
    if (!token) return setLoading(false);
    setToken(token);
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => endSession(false))
      .finally(() => setLoading(false));
  }, [endSession]);

  const login = useCallback(async (email, password) => {
    const { token, user } = await api.login(email, password);
    startSession(token, user);
  }, [startSession]);

  const register = useCallback(async (details) => {
    const { token, user } = await api.register(details);
    startSession(token, user);
  }, [startSession]);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout, loggedOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Guards a page: logged-out users go to /login; with `roles`, other roles see a
// "not permitted" message. This only shapes the UI — the API enforces the same rules.
export function RequireAuth({ roles, children }) {
  const { user, loading, loggedOut } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={loggedOut.current ? null : { from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <main className="page">
        <div className="card">
          <h1>Not permitted</h1>
          <p className="muted">Your account doesn't have access to this page.</p>
        </div>
      </main>
    );
  }
  return children;
}

export function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Loading…</p>;
  return user ? <Navigate to="/profile" replace /> : children;
}
