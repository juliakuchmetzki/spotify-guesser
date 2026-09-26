import { Navigate, useSearchParams } from 'react-router-dom';
import { getToken, LOGIN_URL } from '../utils/api';

export function SpotifyLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14C9.6 9.9 15 10.56 18.72 12.84c.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z" />
    </svg>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');

  if (getToken()) return <Navigate to="/game" replace />;

  return (
    <main className="login">
      <div className="card login-card">
        <div className="login-logo">
          <SpotifyLogo size={64} />
        </div>
        <h1>Song Guesser</h1>
        <p className="muted">
          Erkennst du deine Lieblingssongs nach 0,1 Sekunden? Gespielt wird mit deinen Spotify-Playlists und Lieblingssongs.
        </p>
        {error && <p className="error">{error}</p>}
        <a className="button button-primary button-wide" href={LOGIN_URL}>
          <SpotifyLogo /> Mit Spotify anmelden
        </a>
      </div>
    </main>
  );
}
