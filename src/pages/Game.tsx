import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AudioPlayer, { type ClipPlayer } from '../components/AudioPlayer';
import ResultModal from '../components/ResultModal';
import SearchBar from '../components/SearchBar';
import { useGame } from '../hooks/useGame';
import { useSongAudio } from '../hooks/useSongAudio';
import { useCurrentUser } from '../hooks/useSpotify';
import { useSpotifyPlayback, type SpotifyUnavailableReason } from '../hooks/useSpotifyPlayback';
import { SNIPPET_DURATIONS, type PlaybackSource, type SnippetDuration } from '../types';
import { LOGIN_URL } from '../utils/api';

const LAST_INDEX = SNIPPET_DURATIONS.length - 1;
const SOURCE_KEY = 'previewMode';

function loadSource(): PlaybackSource {
  try {
    return localStorage.getItem(SOURCE_KEY) === 'start' ? 'start' : 'preview';
  } catch {
    return 'preview';
  }
}

function saveSource(source: PlaybackSource) {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    /* ohne Speicher gilt die Wahl nur für diese Sitzung */
  }
}

/** Warum „Anfang“ gerade nicht geht – dann läuft automatisch die Preview. */
function unavailableNote(reason: SpotifyUnavailableReason | 'scope'): ReactNode {
  const relogin = (
    <a href={LOGIN_URL} className="text-button">
      Neu anmelden
    </a>
  );
  switch (reason) {
    case 'scope':
      return <>Für den Song-Anfang braucht die App neue Spotify-Rechte. {relogin} – bis dahin läuft die Preview.</>;
    case 'auth':
      return <>Spotify-Anmeldung abgelaufen. {relogin} – bis dahin läuft die Preview.</>;
    case 'premium':
      return 'Der Song-Anfang braucht Spotify Premium – es läuft die Preview.';
    case 'unsupported':
      return 'Dieser Browser unterstützt den Spotify-Player nicht (z. B. auf dem Handy) – es läuft die Preview.';
    default:
      return 'Spotify-Player nicht verfügbar – es läuft die Preview.';
  }
}

interface RoundProps {
  audio: ClipPlayer;
  disabled: boolean;
  source: PlaybackSource;
  sourceNote?: ReactNode;
  onSourceChange: (source: PlaybackSource) => void;
  onPlay: (duration: SnippetDuration) => void;
  onGuess: (text: string, songId?: number) => void;
  onGiveUp: () => void;
}

/**
 * Eine Runde = ein Song. Wird per key={trackToken} neu gemountet,
 * dadurch beginnt jeder Song wieder bei 0,1 s und mit leerem Suchfeld.
 */
function Round({ audio, disabled, source, sourceNote, onSourceChange, onPlay, onGuess, onGiveUp }: RoundProps) {
  const [snippetIndex, setSnippetIndex] = useState(0);
  const isMaxLength = snippetIndex === LAST_INDEX;

  // Skip springt zur nächsten Stufe; ab 8 s wird daraus „Aufgeben“
  const handleSkipOrGiveUp = () => {
    audio.stop();
    if (isMaxLength) onGiveUp();
    else setSnippetIndex((i) => i + 1);
  };

  return (
    <>
      <AudioPlayer
        audio={audio}
        lengths={SNIPPET_DURATIONS}
        currentIndex={snippetIndex}
        disabled={disabled}
        source={source}
        sourceNote={sourceNote}
        onSourceChange={onSourceChange}
        onPlay={onPlay}
      />
      <SearchBar disabled={disabled} onGuess={onGuess}>
        <button
          type="button"
          className={`skip-btn-small ${isMaxLength ? 'is-giveup' : ''}`}
          disabled={disabled}
          onClick={handleSkipOrGiveUp}
        >
          {isMaxLength ? 'Aufgeben' : 'Skip'}
        </button>
      </SearchBar>
    </>
  );
}

export default function Game() {
  const { me, error: userError, sync, refresh } = useCurrentUser();
  const game = useGame();
  const { session, roundResult } = game;
  // Audio gehört dem Spiel, nicht dem Player: so kann die Preview im Ergebnis-Fenster weiterlaufen
  const activeSessionId = session?.status === 'active' ? session.id : null;
  const trackToken = session?.trackToken ?? null;
  const audio = useSongAudio(activeSessionId, trackToken);

  // „Preview“ (30 s aus der Songmitte, sample-genau) oder „Anfang“ (ab 0:00 über Spotify, Premium)
  const [source, setSource] = useState<PlaybackSource>(loadSource);
  const canStream = me?.playback.canStream ?? false;
  const spotify = useSpotifyPlayback(source === 'start' && canStream && activeSessionId != null, activeSessionId, trackToken);

  let clipPlayer: ClipPlayer = audio;
  let sourceNote: ReactNode;
  if (source === 'start') {
    if (me && !canStream) sourceNote = unavailableNote(me.playback.reason ?? 'scope');
    else if (spotify.status === 'error') sourceNote = unavailableNote(spotify.reason ?? 'error');
    else {
      clipPlayer = spotify;
      if (spotify.error) sourceNote = <span className="error">{spotify.error}</span>;
    }
  }

  const changeSource = (next: PlaybackSource) => {
    audio.stop();
    spotify.stop();
    setSource(next);
    saveSource(next);
  };

  // Nach der Runde übernimmt die Preview im Ergebnis-Fenster → Spotify anhalten
  const spotifyStop = spotify.stop;
  useEffect(() => {
    if (roundResult) spotifyStop();
  }, [roundResult, spotifyStop]);

  const playable = me?.stats.playableCount ?? 0;
  const autoStarted = useRef(false);

  // Keine Startseite: sobald Songs da sind, laufendes Spiel fortsetzen oder neues starten
  useEffect(() => {
    if (autoStarted.current || session || playable === 0) return;
    autoStarted.current = true;
    void game.start(true);
  }, [playable, session, game]);

  // --- Noch kein Spiel: Laden, Sync oder Fehler ---
  if (!session) {
    let message: ReactNode = 'Lädt …';
    if (me?.syncing) message = <span className="blink">Deine Liked Songs werden synchronisiert …</span>;
    else if (me && me.stats.songCount === 0)
      message = (
        <>
          Noch keine Songs geladen.{' '}
          <button type="button" className="text-button" onClick={() => void sync()}>
            Jetzt synchronisieren
          </button>
        </>
      );
    else if (game.busy) message = 'Song wird gesucht …';

    return (
      <main className="game-container">
        <section className="hero">
          <p className="lead">{message}</p>
          {(userError || game.error) && <p className="error">{userError ?? game.error}</p>}
          {game.error && (
            <button type="button" className="button button-primary" onClick={() => void game.start()}>
              Erneut versuchen
            </button>
          )}
        </section>
      </main>
    );
  }

  // --- Endbildschirm ---
  if (session.status !== 'active' && !roundResult) {
    return (
      <main className="game-container">
        <section className="hero">
          <p className="eyebrow">Spiel beendet</p>
          <p className="final-score">{session.score}</p>
          <p className="lead">
            Punkte · {session.correctCount} von {session.totalRounds} Songs erkannt
          </p>
          {session.round < session.totalRounds && session.correctCount < session.totalRounds && (
            <p className="meta">Es gab nicht genug Songs mit verfügbarer Preview für alle Runden.</p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                game.reset();
                void refresh();
                void game.start();
              }}
            >
              Nochmal spielen
            </button>
            <Link to="/stats" className="button button-secondary">
              Statistiken
            </Link>
          </div>
        </section>
      </main>
    );
  }

  // --- Laufendes Spiel ---
  const inputDisabled = game.busy || !!roundResult;
  return (
    <main className="game-container">
      <section className="guess-area">
        {session.trackToken && (
          <Round
            key={session.trackToken}
            audio={clipPlayer}
            disabled={inputDisabled}
            source={source}
            sourceNote={sourceNote}
            onSourceChange={changeSource}
            onPlay={game.recordPlay}
            onGuess={(text, songId) => void game.guess(text, songId)}
            onGiveUp={() => void game.giveUp()}
          />
        )}

        {game.error && <p className="error">{game.error}</p>}
        {game.wrongGuesses.length > 0 && !roundResult && (
          <ol className="wrong-guesses" role="status">
            {game.wrongGuesses.map((g, i) => (
              <li key={i}>✕ {g}</li>
            ))}
          </ol>
        )}
      </section>

      <p className="game-footer">
        Runde {session.round}/{session.totalRounds} · {session.score} Punkte
      </p>

      {roundResult && (
        <ResultModal
          result={roundResult}
          audio={audio}
          gameOver={game.nextSession?.status !== 'active'}
          onNext={game.continueGame}
        />
      )}
    </main>
  );
}
