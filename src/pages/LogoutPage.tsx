import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useSpotify';
import { clearToken } from '../utils/api';

export default function LogoutPage() {
  const { me } = useCurrentUser();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <main className="logout-container">
      <div className="logout-card">
        <h1>Abmelden</h1>

        <div className="account-info">
          <p>Du bist eingeloggt als</p>
          <p className="account-name">{me ? (me.user.displayName ?? 'Spotify-Nutzer') : '…'}</p>
          {me?.user.email && <p className="account-email">{me.user.email}</p>}
          {me && (
            <p className="account-meta">
              {me.stats.songCount} Liked Songs · {me.stats.gamesPlayed} Spiele
            </p>
          )}
        </div>

        <div className="logout-actions">
          <button type="button" className="btn-logout" onClick={handleLogout}>
            Abmelden
          </button>
          <button type="button" className="btn-cancel" onClick={() => navigate('/game')}>
            Zurück zum Spiel
          </button>
        </div>
      </div>
    </main>
  );
}
