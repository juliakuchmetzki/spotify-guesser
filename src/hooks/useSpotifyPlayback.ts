import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { gameApi, userApi } from '../utils/api';
import type { PlaybackMode } from './useSongAudio';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const START_TIMEOUT_MS = 5000;
const DEVICE_RETRY_MS = 1000;
const CONNECT_TIMEOUT_MS = 10000;

export type SpotifyUnavailableReason = 'unsupported' | 'premium' | 'auth' | 'error';

let sdkPromise: Promise<void> | null = null;

/** Lädt das Web Playback SDK einmal pro Seite. */
function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Spotify SDK konnte nicht geladen werden'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Spielt den echten Song-Anfang (ab 0:00) über das Spotify Web Playback SDK.
 * Gleiche Schnittstelle wie der Preview-Player (status, mode, playClip, stop …).
 *
 * Einschränkungen: nur Spotify Premium, nur Desktop-Browser, und die Länge sehr kurzer
 * Snippets ist ungenauer als bei der Preview, weil Start/Pause über Spotify laufen.
 * Die Song-ID bleibt serverseitig – das Backend startet den Track auf diesem Gerät.
 */
export function useSpotifyPlayback(enabled: boolean, sessionId: number | null, trackToken: string | null) {
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceRef = useRef<string | null>(null);
  const loadedTrackRef = useRef<string | null>(null); // Track, der bereits auf dem Gerät geladen ist
  const pauseTimerRef = useRef(0);
  const waitingRef = useRef<((state: Spotify.PlaybackState) => void) | null>(null);
  const requestRef = useRef(0);

  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [reason, setReason] = useState<SpotifyUnavailableReason | null>(null);
  const [starting, setStarting] = useState(false); // Start angefordert, Spotify spielt noch nicht
  const [mode, setMode] = useState<PlaybackMode>(null);
  const [clipLength, setClipLength] = useState(0);
  const [playId, setPlayId] = useState(0);

  const fail = (why: SpotifyUnavailableReason) => {
    setReason(why);
    setStatus('error');
  };

  // Player verbinden, solange der Modus aktiv ist
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let ready = false;
    setStatus('loading');
    setReason(null);
    // Kommt der Player nicht zustande (Netzwerk, Blocker …), nicht ewig warten → Preview
    const connectTimeout = window.setTimeout(() => {
      if (!cancelled && !ready) fail('error');
    }, CONNECT_TIMEOUT_MS);

    loadSdk()
      .then(() => {
        if (cancelled || !window.Spotify) return;
        const player = new window.Spotify.Player({
          name: 'Song Guesser',
          volume: 0.8,
          getOAuthToken: (cb) => {
            userApi.spotifyToken().then(cb, () => fail('auth'));
          },
        });
        player.addListener('ready', ({ device_id }) => {
          deviceRef.current = device_id;
          ready = true;
          window.clearTimeout(connectTimeout);
          if (!cancelled) setStatus('ready');
        });
        player.addListener('not_ready', () => {
          deviceRef.current = null;
          if (!cancelled) setStatus('loading');
        });
        player.addListener('initialization_error', () => fail('unsupported'));
        player.addListener('authentication_error', () => fail('auth'));
        player.addListener('account_error', () => fail('premium'));
        player.addListener('player_state_changed', (state) => {
          if (state && !state.paused) waitingRef.current?.(state);
        });
        playerRef.current = player;
        void player.connect();
      })
      .catch(() => fail('unsupported'));

    return () => {
      cancelled = true;
      window.clearTimeout(connectTimeout);
      window.clearTimeout(pauseTimerRef.current);
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceRef.current = null;
      loadedTrackRef.current = null;
      setMode(null);
      setStatus('idle');
    };
  }, [enabled]);

  const stop = useCallback(() => {
    requestRef.current++;
    window.clearTimeout(pauseTimerRef.current);
    waitingRef.current = null;
    setStarting(false);
    void playerRef.current?.pause().catch(() => undefined);
    setMode(null);
  }, []);

  // Neuer Song → alten stoppen, beim nächsten Play frisch laden
  useEffect(() => {
    loadedTrackRef.current = null;
    stop();
  }, [trackToken, stop]);

  /** true = Spotify spielt; false = hat nicht geklappt (Aufrufer fällt dann auf die Preview zurück) */
  const playClip = useCallback(
    async (length: number): Promise<boolean> => {
      const player = playerRef.current;
      const deviceId = deviceRef.current;
      if (!player || !deviceId || sessionId == null || !trackToken) return false;
      stop();
      const request = ++requestRef.current;
      setStarting(true);
      void player.activateElement(); // nötig für Autoplay in manchen Browsern, muss im Klick passieren

      // Erst reagieren, wenn Spotify wirklich spielt – dann läuft der Timer für die Clip-Länge
      const started = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Spotify hat die Wiedergabe nicht gestartet')), START_TIMEOUT_MS);
        waitingRef.current = () => {
          window.clearTimeout(timeout);
          waitingRef.current = null;
          resolve();
        };
      });

      try {
        if (loadedTrackRef.current === trackToken) {
          await player.seek(0);
          await player.resume();
        } else {
          try {
            await gameApi.spotifyPlay(sessionId, deviceId); // startet ab 0:00
          } catch (err) {
            // Direkt nach "ready" kennt Spotify das Browser-Gerät oft noch nicht (409 = Gerät nicht gefunden)
            if (!axios.isAxiosError(err) || err.response?.status !== 409) throw err;
            await new Promise((r) => setTimeout(r, DEVICE_RETRY_MS));
            if (request !== requestRef.current) return false;
            await gameApi.spotifyPlay(sessionId, deviceId);
          }
          loadedTrackRef.current = trackToken;
        }
        await started;
      } catch (err) {
        if (request === requestRef.current) {
          console.warn('[spotify] Wiedergabe nicht gestartet – Rückfall auf Preview:', (err as Error).message);
          waitingRef.current = null;
          loadedTrackRef.current = null;
          setStarting(false);
          setMode(null);
          void player.pause().catch(() => undefined); // falls Spotify doch noch verspätet loslegt
        }
        return false;
      }
      if (request !== requestRef.current) return false;

      setStarting(false);
      setClipLength(length);
      setPlayId((id) => id + 1);
      setMode('clip');
      pauseTimerRef.current = window.setTimeout(() => {
        void player.pause().catch(() => undefined);
        setMode(null);
      }, length * 1000);
      return true;
    },
    [sessionId, trackToken, stop],
  );

  return { status, reason, starting, mode, clipLength, playId, playClip, stop };
}
