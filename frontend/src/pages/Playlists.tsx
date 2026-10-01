import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LIKED_SOURCE, type PlaylistInfo, type PlaylistsResponse, type SelectedSource } from '../types';
import { errorMessage, LOGIN_URL, playlistApi } from '../utils/api';

function sourceStatus(source: SelectedSource | undefined): string | null {
  if (!source) return null;
  if (source.error) return source.error;
  if (source.trackCount != null) return `${source.trackCount} Songs geladen`;
  return 'Wird geladen …';
}

interface CardProps {
  name: string;
  meta: string;
  imageUrl?: string | null;
  icon?: string;
  selected: boolean;
  status: string | null;
  statusIsError: boolean;
  onToggle: () => void;
}

function SourceCard({ name, meta, imageUrl, icon, selected, status, statusIsError, onToggle }: CardProps) {
  return (
    <button type="button" className={`playlist-card ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onToggle}>
      <span className="playlist-cover">
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span className="playlist-cover-icon">{icon ?? '♪'}</span>}
        <span className="playlist-check" aria-hidden="true">
          ✓
        </span>
      </span>
      <span className="playlist-name">{name}</span>
      <span className="playlist-meta">{meta}</span>
      {selected && status && <span className={`playlist-status ${statusIsError ? 'error' : ''}`}>{status}</span>}
    </button>
  );
}

export default function Playlists() {
  const navigate = useNavigate();
  const [data, setData] = useState<PlaylistsResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    playlistApi
      .list()
      .then((res) => {
        setData(res);
        setSelected(new Set(res.sources.map((s) => s.id)));
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const sourcesById = useMemo(() => new Map(data?.sources.map((s) => [s.id, s]) ?? []), [data]);
  const [available, unavailable] = useMemo(() => {
    const all = data?.playlists ?? [];
    return [all.filter((p) => p.selectable), all.filter((p) => !p.selectable)] as [PlaylistInfo[], PlaylistInfo[]];
  }, [data]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await playlistApi.save([...selected]);
      navigate('/game');
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const cardFor = (id: string) => {
    const source = sourcesById.get(id);
    return { status: sourceStatus(source), statusIsError: !!source?.error };
  };

  return (
    <main className="page playlists-page">
      <header className="playlists-header">
        <h1>Playlists</h1>
        <p className="lead">Wähle, aus welchen Songs gespielt wird – mehrere Quellen werden gemischt.</p>
      </header>

      {data?.missingScope && (
        <p className="notice">
          Um deine Playlists zu sehen, braucht die App neue Spotify-Rechte.{' '}
          <a href={LOGIN_URL} className="text-button">
            Neu anmelden
          </a>
        </p>
      )}
      {data?.syncing && (
        <p className="notice">
          <span className="spinner" aria-hidden="true" />
          Songs werden gerade synchronisiert …
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {!data && !error && (
        <p className="lead">
          <span className="spinner" aria-hidden="true" />
          Playlists werden geladen …
        </p>
      )}

      {data && (
        <>
          <div className="playlist-grid">
            <SourceCard
              name="Lieblingssongs"
              meta="Deine Liked Songs"
              icon="♥"
              selected={selected.has(LIKED_SOURCE)}
              onToggle={() => toggle(LIKED_SOURCE)}
              {...cardFor(LIKED_SOURCE)}
            />
            {available.map((p) => (
              <SourceCard
                key={p.id}
                name={p.name}
                meta={`${p.trackCount} Songs`}
                imageUrl={p.imageUrl}
                selected={selected.has(p.id)}
                onToggle={() => toggle(p.id)}
                {...cardFor(p.id)}
              />
            ))}
          </div>

          {unavailable.length > 0 && (
            <details className="playlists-unavailable">
              <summary>{unavailable.length} Playlists nicht verfügbar</summary>
              <p className="meta">
                Spotify gibt die Songs nur für Playlists frei, die dir gehören oder an denen du mitarbeitest – gefolgte
                Playlists und Spotify-Mixe wie „Discover Weekly“ gehen deshalb nicht. Tipp: In Spotify die Songs in eine
                eigene Playlist kopieren.
              </p>
              <ul>
                {unavailable.map((p) => (
                  <li key={p.id}>
                    {p.name}
                    {p.ownerName && <span className="meta"> · von {p.ownerName}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="playlists-footer">
            <span>
              {selected.size} {selected.size === 1 ? 'Quelle' : 'Quellen'} ausgewählt
            </span>
            <button
              type="button"
              className="button button-primary"
              disabled={selected.size === 0 || saving || data.syncing}
              onClick={() => void save()}
            >
              {saving ? 'Wird gespeichert …' : 'Speichern & spielen'}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
