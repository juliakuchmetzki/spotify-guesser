import type { CSSProperties, ReactNode } from 'react';
import type { PlaybackMode } from '../hooks/useSongAudio';
import type { PlaybackSource, SnippetDuration } from '../types';
import { formatDuration } from '../utils/format';
import TimelineBar from './TimelineBar';

/** Gemeinsame Schnittstelle von Preview-Player (Web Audio) und Spotify-Player (Web Playback SDK). */
export interface ClipPlayer {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mode: PlaybackMode;
  clipLength: number;
  playId: number;
  /** Start angefordert, Ton läuft noch nicht (z. B. Spotify verbindet) */
  starting?: boolean;
  playClip: (length: number) => Promise<unknown>;
  stop: () => void;
}

interface Props {
  audio: ClipPlayer;
  lengths: readonly SnippetDuration[];
  currentIndex: number;
  disabled: boolean;
  source: PlaybackSource;
  /** Hinweis, wenn „Anfang“ gewählt ist, aber (noch) nicht geht */
  sourceNote?: ReactNode;
  onSourceChange: (source: PlaybackSource) => void;
  onPlay: (duration: SnippetDuration) => void;
  /** Lautstärke 0–100 */
  volume: number;
  onVolumeChange: (volume: number) => void;
}

const SOURCE_ICONS: Record<PlaybackSource, ReactNode> = {
  preview: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  ),
  start: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5v14M19 5 9 12l10 7z" />
    </svg>
  ),
};

const SOURCES: { value: PlaybackSource; label: string; title: string }[] = [
  { value: 'preview', label: 'Preview', title: '30-Sekunden-Vorschau (meist aus der Songmitte)' },
  { value: 'start', label: 'Anfang', title: 'Echter Song-Anfang ab 0:00 über Spotify (Premium)' },
];

/** Noten-Symbol, Play/Pause, Timeline mit aktueller Länge. Überspringen sitzt neben dem Suchfeld (siehe Game.tsx). */
export default function AudioPlayer({
  audio,
  lengths,
  currentIndex,
  disabled,
  source,
  sourceNote,
  onSourceChange,
  onPlay,
  volume,
  onVolumeChange,
}: Props) {
  const length = lengths[currentIndex];
  const isPlaying = audio.mode === 'clip';

  const handlePlay = () => {
    if (isPlaying) {
      audio.stop(); // Pause-Symbol → stoppt; nächstes Play beginnt wieder bei 0
      return;
    }
    void audio.playClip(length);
    onPlay(length);
  };

  let status: ReactNode = null;
  if (audio.status === 'loading') status = source === 'start' ? 'Verbinde mit Spotify …' : 'Lädt …';
  else if (audio.status === 'error') status = <span className="error">Nicht verfügbar</span>;
  else if (audio.starting) status = 'Starte Spotify …';

  return (
    <div className="audio-player">
      <svg className={`song-icon ${isPlaying ? 'is-playing' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>

      <label className="volume-control">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7" />
        </svg>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          aria-label="Lautstärke"
          style={{ '--volume': `${volume}%` } as CSSProperties}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
        <span className="volume-value">{volume}%</span>
      </label>

      <button
        type="button"
        className={`play-btn ${isPlaying ? 'is-playing' : ''}`}
        disabled={disabled || audio.status !== 'ready' || audio.starting}
        onClick={handlePlay}
        aria-label={isPlaying ? 'Pause' : `${formatDuration(length)} abspielen`}
      >
        <svg className="icon-play" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        <svg className="icon-pause" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      </button>

      <div className="timeline-row">
        <TimelineBar
          lengths={lengths}
          currentIndex={currentIndex}
          isPlaying={isPlaying}
          clipDuration={audio.clipLength}
          playId={audio.playId}
        />
        <span className="current-time" aria-live="polite">
          {formatDuration(length)}
        </span>
      </div>
      <div className="player-footer">
        <div className="preview-toggle" role="radiogroup" aria-label="Wiedergabe">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={source === s.value}
              className={source === s.value ? 'active' : ''}
              title={s.title}
              onClick={() => onSourceChange(s.value)}
            >
              {SOURCE_ICONS[s.value]}
              {s.label}
            </button>
          ))}
        </div>
        {status && <p className="player-status">{status}</p>}
      </div>
      {sourceNote && <p className="source-note">{sourceNote}</p>}
    </div>
  );
}
