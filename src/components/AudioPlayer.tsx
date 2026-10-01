import type { ReactNode } from 'react';
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
}

const SOURCES: { value: PlaybackSource; label: string; title: string }[] = [
  { value: 'preview', label: '🔊 Preview', title: '30-Sekunden-Vorschau (meist aus der Songmitte)' },
  { value: 'start', label: '📻 Anfang', title: 'Echter Song-Anfang ab 0:00 über Spotify (Premium)' },
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
      {status && <p className="player-status">{status}</p>}

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
            {s.label}
          </button>
        ))}
      </div>
      {sourceNote && <p className="source-note">{sourceNote}</p>}
    </div>
  );
}
