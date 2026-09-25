import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useSpotify';
import type { Highscore, HistoryEntry } from '../types';
import { errorMessage, gameApi } from '../utils/api';

// SQLite liefert "YYYY-MM-DD HH:MM:SS" in UTC
const formatDate = (value: string | null) =>
  value
    ? new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    : '–';

export default function Stats() {
  const { me, error: userError, sync } = useCurrentUser();
  const [highscores, setHighscores] = useState<Highscore[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([gameApi.highscores(), gameApi.history()])
      .then(([h, g]) => {
        setHighscores(h);
        setHistory(g);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const stats = me?.stats;
  const hitRate = stats && stats.totalRounds > 0 ? Math.round((stats.totalCorrect / stats.totalRounds) * 100) : 0;

  return (
    <main className="page">
      <h1>Statistiken</h1>
      {(userError || error) && <p className="error">{userError ?? error}</p>}

      {stats && (
        <div className="stat-grid">
          <div className="stat-box">
            <span className="stat-label">Spiele</span>
            <strong className="stat-value">{stats.gamesPlayed}</strong>
          </div>
          <div className="stat-box">
            <span className="stat-label">Bestwert</span>
            <strong className="stat-value">{stats.bestScore}</strong>
          </div>
          <div className="stat-box">
            <span className="stat-label">Ø Punkte</span>
            <strong className="stat-value">{stats.averageScore.toLocaleString('de-DE')}</strong>
          </div>
          <div className="stat-box">
            <span className="stat-label">Trefferquote</span>
            <strong className="stat-value">{hitRate} %</strong>
          </div>
        </div>
      )}

      {me && (
        <div className="card library">
          <div>
            <strong>{me.stats.songCount} Liked Songs</strong>
            <span className="muted">
              {' '}
              · {me.stats.playableCount} spielbar · letzter Sync: {formatDate(me.user.lastSync)}
            </span>
          </div>
          <button type="button" className="button button-secondary" disabled={me.syncing} onClick={() => void sync()}>
            {me.syncing ? 'Synchronisiere …' : 'Jetzt synchronisieren'}
          </button>
        </div>
      )}

      <div className="two-columns">
        <section className="card">
          <h2>🏆 Highscores</h2>
          {highscores.length === 0 ? (
            <p className="muted">Noch keine abgeschlossenen Spiele.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Spieler</th>
                  <th className="num">Punkte</th>
                  <th className="num">Treffer</th>
                </tr>
              </thead>
              <tbody>
                {highscores.map((h, i) => (
                  <tr key={h.sessionId}>
                    <td>{i + 1}</td>
                    <td>{h.displayName}</td>
                    <td className="num">{h.score}</td>
                    <td className="num">{h.correctCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2>Deine letzten Spiele</h2>
          {history.length === 0 ? (
            <p className="muted">
              Noch nichts gespielt. <Link to="/game">Los geht's!</Link>
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th className="num">Punkte</th>
                  <th className="num">Treffer</th>
                </tr>
              </thead>
              <tbody>
                {history.map((g) => (
                  <tr key={g.id}>
                    <td>{formatDate(g.createdAt)}</td>
                    <td className="num">{g.score}</td>
                    <td className="num">{g.correctCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
