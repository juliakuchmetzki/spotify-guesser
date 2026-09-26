import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import Game from './pages/Game';
import Login, { SpotifyLogo } from './pages/Login';
import LogoutPage from './pages/LogoutPage';
import Playlists from './pages/Playlists';
import Stats from './pages/Stats';
import { getToken, setToken } from './utils/api';

/** Ziel des OAuth-Redirects: übernimmt das JWT aus dem URL-Fragment. */
function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (token) setToken(token);
    navigate(getToken() ? '/game' : '/login?error=Anmeldung%20fehlgeschlagen', { replace: true });
  }, [navigate]);

  return <p className="muted center">Anmeldung läuft …</p>;
}

function Protected({ children, header = true }: { children: ReactNode; header?: boolean }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  if (!header) return <>{children}</>;

  return (
    <>
      <header className="header">
        <NavLink to="/game" className="brand">
          <SpotifyLogo /> <span>Song Guesser</span>
        </NavLink>
        <nav>
          <NavLink to="/game">Spiel</NavLink>
          <NavLink to="/playlists">Playlists</NavLink>
          <NavLink to="/stats">Statistiken</NavLink>
          <NavLink to="/logout" className="logout-link" title="Abmelden" aria-label="Abmelden">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
              <path d="M10 17l-5-5 5-5" />
              <path d="M5 12h11" />
            </svg>
          </NavLink>
        </nav>
      </header>
      {children}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/game" element={<Protected><Game /></Protected>} />
        <Route path="/playlists" element={<Protected><Playlists /></Protected>} />
        <Route path="/stats" element={<Protected><Stats /></Protected>} />
        <Route path="/logout" element={<Protected header={false}><LogoutPage /></Protected>} />
        <Route path="*" element={<Navigate to={getToken() ? '/game' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
