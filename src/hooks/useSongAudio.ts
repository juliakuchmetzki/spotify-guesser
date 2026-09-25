import { useCallback, useEffect, useRef, useState } from 'react';
import { gameApi } from '../utils/api';

const FADE_SECONDS = 0.005; // verhindert Knackser an Anfang/Ende
const START_DELAY = 0.02;

export type PlaybackMode = 'clip' | 'full' | null;

/**
 * Lädt die Preview des aktuellen Songs einmal und spielt sie über die Web Audio API:
 * - playClip(length): sample-genaues Snippet ab Sekunde 0 (fürs Raten)
 * - playFull()/pauseFull(): ganze Preview mit Pause/Weiter (nach der Runde)
 * Der Buffer bleibt erhalten, bis sich trackToken ändert – also auch während das
 * Ergebnis-Fenster offen ist, obwohl das Backend schon zum nächsten Song gewechselt hat.
 */
export function useSongAudio(sessionId: number | null, trackToken: string | null) {
  const contextRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const requestRef = useRef(0); // verwirft Play-Aufrufe, die während ctx.resume() überholt wurden
  const fullOffsetRef = useRef(0); // Pausenposition der ganzen Preview (s)
  const fullStartRef = useRef(0); // ctx.currentTime beim Start der ganzen Preview
  const frameRef = useRef(0);

  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [mode, setMode] = useState<PlaybackMode>(null);
  const [clipLength, setClipLength] = useState(0);
  const [playId, setPlayId] = useState(0);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const getContext = () => (contextRef.current ??= new AudioContext());

  const stopSource = useCallback(() => {
    requestRef.current++;
    cancelAnimationFrame(frameRef.current);
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* war schon gestoppt */
      }
    }
  }, []);

  const stop = useCallback(() => {
    stopSource();
    setMode(null);
  }, [stopSource]);

  useEffect(() => {
    if (sessionId == null || !trackToken) return;
    let cancelled = false;
    stop();
    bufferRef.current = null;
    fullOffsetRef.current = 0;
    setPosition(0);
    setDuration(0);
    setStatus('loading');

    gameApi
      .audio(sessionId)
      .then((data) => getContext().decodeAudioData(data))
      .then((buffer) => {
        if (cancelled) return;
        bufferRef.current = buffer;
        setDuration(buffer.duration);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionId, trackToken, stop]);

  useEffect(
    () => () => {
      void contextRef.current?.close();
      contextRef.current = null;
    },
    [],
  );

  /** Startet eine Quelle; gibt Startzeit zurück oder null, wenn der Aufruf überholt wurde. */
  const start = async (offset: number, length: number, fade: boolean, onEnded: () => void) => {
    const buffer = bufferRef.current;
    if (!buffer) return null;
    stopSource();
    const request = ++requestRef.current;
    const ctx = getContext();
    await ctx.resume(); // Browser starten AudioContext erst nach einer User-Geste
    if (request !== requestRef.current) return null;

    const startAt = ctx.currentTime + START_DELAY;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (fade) {
      const gain = ctx.createGain();
      const f = Math.min(FADE_SECONDS, length / 4);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(1, startAt + f);
      gain.gain.setValueAtTime(1, startAt + length - f);
      gain.gain.linearRampToValueAtTime(0, startAt + length);
      source.connect(gain).connect(ctx.destination);
    } else {
      source.connect(ctx.destination);
    }
    source.onended = () => {
      if (sourceRef.current !== source) return;
      sourceRef.current = null;
      cancelAnimationFrame(frameRef.current);
      onEnded();
    };
    source.start(startAt, offset, length);
    sourceRef.current = source;
    return startAt;
  };

  const playClip = useCallback(async (length: number) => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const clip = Math.min(length, buffer.duration);
    const startAt = await start(0, clip, true, () => setMode(null));
    if (startAt == null) return;
    fullOffsetRef.current = 0;
    setClipLength(clip + START_DELAY);
    setPlayId((id) => id + 1);
    setMode('clip');
  }, []);

  const playFull = useCallback(async () => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    if (fullOffsetRef.current >= buffer.duration - 0.05) fullOffsetRef.current = 0; // am Ende → von vorn
    const offset = fullOffsetRef.current;
    const startAt = await start(offset, buffer.duration - offset, false, () => {
      fullOffsetRef.current = buffer.duration;
      setPosition(buffer.duration);
      setMode(null);
    });
    if (startAt == null) return;
    fullStartRef.current = startAt - offset;
    setMode('full');

    const ctx = getContext();
    const tick = () => {
      setPosition(Math.min(Math.max(ctx.currentTime - fullStartRef.current, 0), buffer.duration));
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const pauseFull = useCallback(() => {
    const ctx = contextRef.current;
    if (ctx) fullOffsetRef.current = Math.max(ctx.currentTime - fullStartRef.current, 0);
    setPosition(fullOffsetRef.current);
    stop();
  }, [stop]);

  return { status, mode, clipLength, playId, position, duration, playClip, playFull, pauseFull, stop };
}

export type SongAudio = ReturnType<typeof useSongAudio>;
