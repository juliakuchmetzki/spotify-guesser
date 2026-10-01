import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AudioPlayer, { type ClipPlayer } from '../components/AudioPlayer';
import DifficultySelector from '../components/DifficultySelector';
import ResultModal from '../components/ResultModal';
import SearchBar from '../components/SearchBar';
import { useGame } from '../hooks/useGame';
import { useSongAudio } from '../hooks/useSongAudio';
import { useCurrentUser } from '../hooks/useSpotify';
import { useSpotifyPlayback, type SpotifyUnavailableReason } from '../hooks/useSpotifyPlayback';
import { SNIPPET_DURATIONS, type PlaybackSource, type RoundResult, type SnippetDuration } from '../types';
import { gameApi, LOGIN_URL } from '../utils/api';
import { accentStyle, getDifficulty, loadDifficulty, saveDifficulty, type DifficultyId } from '../utils/difficulty';
import { loadStats, recordRound, type RoundStats } from '../utils/roundStats';

const SOURCE_KEY = 'previewMode';

/** Gespeicherte Wahl; null = noch nie gewählt → Spotify, wenn verfügbar */
function loadSource(): PlaybackSource | null {
  try {
    const value = localStorage.getItem(SOURCE_KEY);
    return value === 'start' || value === 'preview' ? value : null;
  } catch {
    return null;
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
  lengths: readonly SnippetDuration[];
  attempt: number;
  disabled: boolean;
  source: PlaybackSource;
  sourceNote?: ReactNode;
  onSourceChange: (source: PlaybackSource) => void;
  onPlay: (duration: SnippetDuration) => void;
  onSkip: () => void;
  onGuess: (text: string, songId?: number) => void;
  onGiveUp: () => void;
}

/**
 * Eine Runde = ein Song. Wird per key={trackToken} neu gemountet (leeres Suchfeld).
 * Der Versuch (= freigeschaltete Stufe) liegt in Game, weil auch Kopfzeile und Ergebnis ihn brauchen.
 */
function Round({ audio, lengths, attempt, disabled, source, sourceNote, onSourceChange, onPlay, onSkip, onGuess, onGiveUp }: RoundProps) {
  const isLastAttempt = attempt === lengths.length - 1;

  // Überspringen schaltet die nächste Stufe frei; auf der letzten wird daraus „Aufgeben“
  const handleSkipOrGiveUp = () => {
    audio.stop();
    if (isLastAttempt) onGiveUp();
    else onSkip();
  };

  return (
    <>
      <AudioPlayer
        audio={audio}
        lengths={lengths}
        currentIndex={attempt}
        disabled={disabled}
        source={source}
        sourceNote={sourceNote}
        onSourceChange={onSourceChange}
        onPlay={onPlay}
      />
      <SearchBar disabled={disabled} onGuess={onGuess} isLastAttempt={isLastAttempt} onSkip={handleSkipOrGiveUp} />
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

  // Schwierigkeit = Farbe + Anzahl Versuche (Snippet-Stufen); nur im Frontend, das Backend kennt sie nicht
  const [difficultyId, setDifficultyId] = useState<DifficultyId>(loadDifficulty);
  const difficulty = getDifficulty(difficultyId);
  const lengths = SNIPPET_DURATIONS.slice(0, difficulty.stages);
  const theme = accentStyle(difficulty);
  const changeDifficulty = (id: DifficultyId) => {
    setDifficultyId(id);
    saveDifficulty(id);
  };

  // Versuch gehört zum Song: neuer trackToken → wieder Versuch 1
  const [attemptState, setAttemptState] = useState({ token: trackToken, index: 0 });
  const attempt = Math.min(attemptState.token === trackToken ? attemptState.index : 0, lengths.length - 1);
  const nextAttempt = () => setAttemptState({ token: trackToken, index: attempt + 1 });

  // Lokale Statistik: jede beendete Runde genau einmal zählen
  const [stats, setStats] = useState<RoundStats>(loadStats);
  const recordedResult = useRef<RoundResult | null>(null);

  // „Anfang“ (ab 0:00 über Spotify, Premium) ist Standard, sobald verfügbar; sonst „Preview“ (Deezer, 30 s)
  const [storedSource, setStoredSource] = useState<PlaybackSource | null>(loadSource);
  // Hat Spotify beim Abspielen nicht reagiert, läuft der Rest der Sitzung über die Preview (wird nicht gespeichert)
  const [spotifyFallback, setSpotifyFallback] = useState(false);
  const canStream = me?.playback.canStream ?? false;
  const source: PlaybackSource = spotifyFallback ? 'preview' : (storedSource ?? (canStream ? 'start' : 'preview'));
  // Player schon vor dem Spielstart verbinden, damit feststeht, ob Spotify wirklich geht
  const spotify = useSpotifyPlayback(source === 'start' && canStream, activeSessionId, trackToken);
  const spotifyReady = source === 'start' && canStream && spotify.status === 'ready';
  const spotifyPending = source === 'start' && canStream && (spotify.status === 'idle' || spotify.status === 'loading');
  const startGame = (resume = false) => void game.start(resume, spotifyReady);

  // Spotify zuerst; startet es nicht (kein Gerät, Timeout …), läuft derselbe Clip sofort als Preview
  const spotifyWithFallback: ClipPlayer = {
    ...spotify,
    playClip: async (length: number) => {
      if (await spotify.playClip(length)) return;
      setSpotifyFallback(true);
      if (activeSessionId != null) void gameApi.setPlayback(activeSessionId, false).catch(() => undefined);
      await audio.playClip(length);
    },
  };

  let clipPlayer: ClipPlayer = audio;
  let sourceNote: ReactNode;
  if (spotifyFallback && storedSource !== 'preview') {
    sourceNote = 'Spotify hat nicht reagiert – es läuft die Preview.';
  } else if (source === 'start') {
    if (me && !canStream) sourceNote = unavailableNote(me.playback.reason ?? 'scope');
    else if (spotify.status === 'error') sourceNote = unavailableNote(spotify.reason ?? 'error');
    else clipPlayer = spotifyWithFallback;
  }

  const changeSource = (next: PlaybackSource) => {
    audio.stop();
    spotify.stop();
    setStoredSource(next);
    saveSource(next);
    // Erneut „Anfang“ gewählt → Spotify noch einmal versuchen (auch fürs laufende Spiel)
    setSpotifyFallback(false);
    if (activeSessionId != null && canStream) {
      void gameApi.setPlayback(activeSessionId, next === 'start' && spotify.status === 'ready').catch(() => undefined);
    }
  };

  // Nach der Runde übernimmt die Preview im Ergebnis-Fenster → Spotify anhalten
  const spotifyStop = spotify.stop;
  useEffect(() => {
    if (roundResult) spotifyStop();
  }, [roundResult, spotifyStop]);

  useEffect(() => {
    if (!roundResult || recordedResult.current === roundResult) return;
    recordedResult.current = roundResult;
    setStats(recordRound(roundResult.outcome === 'correct' ? attempt : null));
  }, [roundResult, attempt]);

  const playable = me?.stats.playableCount ?? 0;
  const autoStarted = useRef(false);

  // Keine Startseite: sobald Songs da sind (und klar ist, ob Spotify spielt), fortsetzen oder neu starten
  useEffect(() => {
    // Während eines Syncs (z. B. nach neuer Playlist-Auswahl) warten, bis alle Songs da sind
    if (autoStarted.current || session || playable === 0 || spotifyPending || me?.syncing) return;
    autoStarted.current = true;
    void game.start(true, spotifyReady);
  }, [playable, session, game, spotifyPending, spotifyReady, me?.syncing]);

  // Noch keine Song-Quelle gewählt → zuerst Playlists auswählen
  if (me && me.sourceCount === 0) return <Navigate to="/playlists" replace />;

  // --- Noch kein Spiel: Laden, Sync oder Fehler ---
  if (!session) {
    const spinner = <span className="spinner" aria-hidden="true" />;
    let message: ReactNode = <>{spinner}Lädt …</>;
    if (me?.syncing) message = <>{spinner}Deine Songs werden geladen …</>;
    else if (me && me.stats.songCount === 0)
      message = (
        <>
          In deinen ausgewählten Playlists sind keine Songs.{' '}
          <Link to="/playlists" className="text-button">
            Playlists ändern
          </Link>{' '}
          ·{' '}
          <button type="button" className="text-button" onClick={() => void sync()}>
            Neu synchronisieren
          </button>
        </>
      );
    else if (spotifyPending) message = <>{spinner}Verbinde mit Spotify …</>;
    else if (game.busy) message = <>{spinner}Song wird gesucht …</>;

    return (
      <main className="game-container" style={theme}>
        <section className="hero">
          <p className="lead">{message}</p>
          {(userError || game.error) && <p className="error">{userError ?? game.error}</p>}
          {game.error && (
            <button type="button" className="button button-primary" onClick={() => startGame()}>
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
      <main className="game-container" style={theme}>
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
                startGame();
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
    <main className="game-container" style={theme}>
      <DifficultySelector value={difficultyId} onChange={changeDifficulty} />

      <header className="game-heading">
        <h1>Errate den Song</h1>
        <p className="game-meta">
          <span className="game-number">#{session.round}</span>
          <span>
            {attempt} von {difficulty.stages} Versuchen
          </span>
        </p>
      </header>

      <section className="guess-area">
        {session.trackToken && (
          <Round
            key={session.trackToken}
            audio={clipPlayer}
            lengths={lengths}
            attempt={attempt}
            disabled={inputDisabled}
            source={source}
            sourceNote={sourceNote}
            onSourceChange={changeSource}
            onPlay={game.recordPlay}
            onSkip={nextAttempt}
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
          round={session.round}
          totalRounds={session.totalRounds}
          difficulty={difficulty}
          attempt={attempt}
          stats={stats}
        />
      )}
    </main>
  );
}
