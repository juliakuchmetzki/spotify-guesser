import { useCallback, useRef, useState } from 'react';
import type { GameSession, RoundResult } from '../types';
import { errorMessage, gameApi } from '../utils/api';

export function useGame() {
  const [session, setSession] = useState<GameSession | null>(null);
  // Ergebnis des gerade beendeten Songs (für das Modal) + Zustand danach, der erst beim "Weiter" übernommen wird
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [nextSession, setNextSession] = useState<GameSession | null>(null);
  // Falsche Tipps je Schwierigkeitsstufe: beim Zurückwechseln bleiben sie sichtbar
  const [wrongBySlot, setWrongBySlot] = useState<Record<number, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingPlay = useRef<Promise<void>>(Promise.resolve());
  const heardRef = useRef<Record<number, number>>({}); // längstes gehörtes Snippet je Stufe

  const wrongGuesses = session ? (wrongBySlot[session.difficulty] ?? []) : [];

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

  const clearRound = () => {
    heardRef.current = {};
    setRoundResult(null);
    setNextSession(null);
    setWrongBySlot({});
  };

  /** Neues Spiel; mit resume = true wird ein laufendes Spiel fortgesetzt, falls vorhanden. */
  const start = useCallback(
    (resume = false, spotify = false) =>
      run(async () => {
        const state = (resume ? await gameApi.active() : null) ?? (await gameApi.start(spotify));
        setSession(state);
        clearRound();
      }),
    [run],
  );

  /** Meldet dem Backend die gehörte Snippet-Länge (relevant für den Bonus). */
  const recordPlay = useCallback(
    (duration: number) => {
      if (!session) return;
      const slot = session.difficulty;
      heardRef.current[slot] = Math.max(heardRef.current[slot] ?? 0, duration);
      pendingPlay.current = gameApi
        .play(session.id, duration)
        .then(() => undefined)
        .catch((err) => setError(errorMessage(err)));
    },
    [session],
  );

  /** Wechselt zu einer anderen Schwierigkeitsstufe – das ist ein anderer Song. */
  const switchDifficulty = useCallback(
    (difficulty: number) =>
      run(async () => {
        if (!session || difficulty === session.difficulty) return;
        await pendingPlay.current;
        setSession(await gameApi.switchDifficulty(session.id, difficulty));
      }),
    [run, session],
  );

  const addWrong = (slot: number, text: string) =>
    setWrongBySlot((all) => ({ ...all, [slot]: [...(all[slot] ?? []), text] }));

  const guess = useCallback(
    (text: string, songId?: number) =>
      run(async () => {
        if (!session) return;
        const slot = session.difficulty;
        // Snippet-Länge muss vor dem Tipp gespeichert sein, sonst stimmt der Bonus nicht
        await pendingPlay.current;
        const res = await gameApi.guess(session.id, text, songId);
        if (res.roundOver && res.reveal) {
          setRoundResult({
            outcome: res.correct ? 'correct' : 'failed',
            points: res.points,
            reveal: res.reveal,
            heard: heardRef.current[slot] ?? 0,
          });
          setNextSession(res.state);
          if (!res.correct) addWrong(slot, text);
        } else {
          addWrong(slot, text);
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
        setRoundResult({ outcome: 'gaveup', points: 0, reveal: res.reveal, heard: heardRef.current[session.difficulty] ?? 0 });
        setNextSession(res.state);
      }),
    [run, session],
  );

  const continueGame = useCallback(() => {
    if (nextSession) setSession(nextSession);
    setNextSession(null);
    setRoundResult(null);
  }, [nextSession]);

  const reset = useCallback(() => {
    setSession(null);
    clearRound();
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
    switchDifficulty,
    guess,
    giveUp,
    continueGame,
    reset,
  };
}
