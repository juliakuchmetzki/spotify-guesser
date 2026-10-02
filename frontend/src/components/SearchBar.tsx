import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSongSearch } from '../hooks/useSpotify';
import type { Song } from '../types';

interface Props {
  disabled: boolean;
  onGuess: (text: string, songId?: number) => void;
  /** Rechter Button ohne Vorschläge: Überspringen bzw. auf der letzten Stufe Aufgeben */
  isLastAttempt: boolean;
  onSkip: () => void;
}

export default function SearchBar({ disabled, onGuess, isLastAttempt, onSkip }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const { results, loading } = useSongSearch(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: 280 });
  const listId = useId();

  useEffect(() => setHighlighted(-1), [results]);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const submit = (text: string, songId?: number) => {
    if (!text.trim() || disabled) return;
    onGuess(text.trim(), songId);
    setQuery('');
    setOpen(false);
  };

  const choose = (song: Song) => submit(`${song.title} – ${song.artist}`, song.id);

  // Enter: markierter Treffer, sonst Freitext
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (open && highlighted >= 0 && results[highlighted]) choose(results[highlighted]);
    else submit(query);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && query.trim().length > 0;

  // Liste nur so hoch, wie der Platz im Fenster reicht; bei wenig Platz unten nach oben aufklappen
  useLayoutEffect(() => {
    if (!showList || !fieldRef.current) return;
    const place = () => {
      const rect = fieldRef.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const up = below < 200 && above > below;
      setPlacement({ up, maxHeight: Math.max(120, Math.min(280, up ? above : below)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showList, results.length]);
  // Mit Vorschlägen wird aus „Überspringen“ ein grüner „Raten“-Button (markierter oder erster Treffer)
  const canGuess = showList && results.length > 0;

  return (
    <form className="search-skip-container" onSubmit={handleSubmit}>
      <div className="search-field" ref={fieldRef}>
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          className="search-box"
          placeholder="Song suchen …"
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
        />
        {showList && (
          <ul
            className={`autocomplete-list ${placement.up ? 'is-up' : ''}`}
            id={listId}
            role="listbox"
            style={{ maxHeight: placement.maxHeight }}
          >
            {results.map((song, i) => (
              <li
                key={song.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlighted}
                className={`autocomplete-item ${i === highlighted ? 'is-highlighted' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(song);
                }}
                onMouseEnter={() => setHighlighted(i)}
              >
                {song.imageUrl ? <img src={song.imageUrl} alt="" /> : <span className="cover-placeholder">♪</span>}
                <span className="suggestion-text">
                  <strong>{song.title}</strong>
                  <span className="muted">{song.artist}</span>
                </span>
              </li>
            ))}
            {!loading && results.length === 0 && <li className="autocomplete-item empty">Kein Treffer in deinen Playlists</li>}
          </ul>
        )}
      </div>
      <button
        type="button"
        className={`action-btn ${canGuess ? 'is-guess' : isLastAttempt ? 'is-giveup' : ''}`}
        disabled={disabled}
        // Fokus im Suchfeld lassen, sonst schließt die Vorschlagsliste vor dem Klick
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (canGuess ? choose(results[Math.max(highlighted, 0)]) : onSkip())}
      >
        {canGuess ? 'Raten' : isLastAttempt ? 'Aufgeben' : 'Überspringen'}
      </button>
    </form>
  );
}
