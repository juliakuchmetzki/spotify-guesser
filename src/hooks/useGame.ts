import { useCallback, useRef, useState } from 'react';
import type { GameSession, RoundResult } from '../types';
import { errorMessage, gameApi } from '../utils/api';

export function useGame() {
  const [session, setSession] = useState<GameSession | null>(null);
  // Ergebnis der gerade beendeten Runde (für das Modal) + Zustand danach, der erst beim "Weiter" übernommen wird
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [nextSession, setNextSession] = useState<GameSession | null>(null);
  const [wrongGuesses, setWrongGuesses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingPlay = useRef<Promise<void>>(Promise.resolve());
  const heardRef = useRef(0); // längstes gehörtes Snippet der aktuellen Runde

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Neues Spiel; mit resume = true wird ein laufendes Spiel fortgesetzt, falls vorhanden. */
  const start = useCallback(
    (resume = false) =>
      run(async () => {
        const state = (resume ? await gameApi.active() : null) ?? (await gameApi.start());
        heardRef.current = 0;
        setSession(state);
        setRoundResult(null);
        setNextSession(null);
        setWrongGuesses([]);
      }),
    [run],
  );

  /** Meldet dem Backend die gehörte Snippet-Länge (relevant für den Bonus). */
  const recordPlay = useCallback(
    (duration: number) => {
      if (!session) return;
      heardRef.current = Math.max(heardRef.current, duration);
      pendingPlay.current = gameApi
        .play(session.id, duration)
        .then(() => undefined)
        .catch((err) => setError(errorMessage(err)));
    },
    [session],
  );

  const guess = useCallback(
    (text: string, songId?: number) =>
      run(async () => {
        if (!session) return;
        // Snippet-Länge muss vor dem Tipp gespeichert sein, sonst stimmt der Bonus nicht
        await pendingPlay.current;
        const res = await gameApi.guess(session.id, text, songId);
        if (res.roundOver && res.reveal) {
          setRoundResult({
            outcome: res.correct ? 'correct' : 'failed',
            points: res.points,
            reveal: res.reveal,
            heard: heardRef.current,
          });
          setNextSession(res.state);
          if (!res.correct) setWrongGuesses((g) => [...g, text]);
        } else {
          setWrongGuesses((g) => [...g, text]);
          setSession(res.state);
        }
      }),
    [run, session],
  );

  const giveUp = useCallback(
    () =>
      run(async () => {
        if (!session) return;
        const res = await gameApi.giveUp(session.id);
        if (!res.reveal) return;
        setRoundResult({ outcome: 'gaveup', points: 0, reveal: res.reveal, heard: heardRef.current });
        setNextSession(res.state);
      }),
    [run, session],
  );

  const continueGame = useCallback(() => {
    heardRef.current = 0;
    if (nextSession) setSession(nextSession);
    setNextSession(null);
    setRoundResult(null);
    setWrongGuesses([]);
  }, [nextSession]);

  const reset = useCallback(() => {
    setSession(null);
    setRoundResult(null);
    setNextSession(null);
    setWrongGuesses([]);
    setError(null);
  }, []);

  return {
    session,
    roundResult,
    nextSession,
    wrongGuesses,
    busy,
    error,
    start,
    recordPlay,
    guess,
    giveUp,
    continueGame,
    reset,
  };
}
