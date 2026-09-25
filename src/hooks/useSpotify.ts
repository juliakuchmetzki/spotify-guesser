import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import type { MeResponse, Song } from '../types';
import { errorMessage, songApi, userApi } from '../utils/api';

const SYNC_POLL_MS = 3000;
const SEARCH_DEBOUNCE_MS = 200;

/** Aktueller User + Stats; pollt, solange ein Spotify-Sync läuft. */
export function useCurrentUser() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await userApi.me());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!me?.syncing) return;
    const timer = setInterval(() => void refresh(), SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [me?.syncing, refresh]);

  const sync = useCallback(async () => {
    try {
      await songApi.sync();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [refresh]);

  return { me, error, refresh, sync };
}

/** Autocomplete über die eigenen Liked Songs (debounced, alte Requests werden abgebrochen). */
export function useSongSearch(query: string) {
  const [results, setResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      songApi
        .search(q, controller.signal)
        .then(setResults)
        .catch((err) => {
          if (!axios.isCancel(err)) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { results, loading };
}
