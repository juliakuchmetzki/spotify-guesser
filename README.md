# 🎵 Spotify Song Guesser

Rate Songs aus deinen Spotify Liked Songs anhand von 0,1 s bis 8 s langen Snippets.

- **Backend:** Express 5 + TypeScript, SQLite (eingebautes `node:sqlite`), täglicher Sync per `node-cron`
- **Frontend:** React 18 + Vite, Web Audio API für sample-genaue Snippets

## Einrichtung

1. **Spotify-App anlegen** auf <https://developer.spotify.com/dashboard>
   - Redirect URI: `http://127.0.0.1:5000/api/auth/callback`
     (Spotify akzeptiert `localhost` nicht mehr, nur die Loopback-IP)
   - APIs: *Web API*
   - Unter **User Management** alle Spotify-Accounts eintragen, die spielen sollen (Development Mode)
2. `backend/.env` ausfüllen: `SPOTIFY_CLIENT_ID` und `SPOTIFY_CLIENT_SECRET`
   (`JWT_SECRET` ist bereits zufällig generiert; Vorlage: `backend/.env.example`)

## Starten

```bash
cd backend
npm install
npm run dev        # http://127.0.0.1:5000

cd frontend        # zweites Terminal
npm install
npm run dev        # http://127.0.0.1:3000
```

Dann im Browser **http://127.0.0.1:3000** öffnen (nicht `localhost`, sonst passt die Redirect-URI nicht).
Nach dem ersten Login werden deine Liked Songs automatisch im Hintergrund synchronisiert.

## Spielregeln

- 5 Runden, unbegrenzt viele Versuche pro Song
- 10 Punkte pro Treffer, −2 pro Fehlversuch, +5 Bonus, wenn nur 0,1 s / 0,5 s gehört wurden
- Play spielt das aktuelle Fenster (beliebig oft), Skip schaltet das nächste frei: 0,1 s → 0,5 s → 1 s → 2 s → 4 s → 8 s
- Aufgeben (erst möglich, wenn 8 s freigeschaltet sind) beendet die Runde ohne Punkte und zeigt die Lösung
- Als Tipp zählt ein Eintrag aus der Autovervollständigung oder der Titel als Freitext
  (Groß-/Kleinschreibung, Akzente und Zusätze wie „feat.“/„Remastered“ werden ignoriert)

## Song-Quellen (Playlists)

Unter **Playlists** wählst du, aus welchen Songs gespielt wird: deine Lieblingssongs und/oder eigene Playlists –
mehrere Quellen werden gemischt. Beim ersten Login erscheint die Auswahl automatisch. Die gewählten Quellen werden
beim Speichern, nach dem Login (falls älter als 6 h) und täglich um 00:00 UTC synchronisiert.

Seit den Spotify-Web-API-Änderungen vom Februar 2026 liefert Spotify Playlist-Inhalte nur noch für Playlists, die
dir gehören oder an denen du mitarbeitest. Gefolgte Playlists und Spotify-Mixe (z. B. „Discover Weekly“) erscheinen
deshalb als „nicht verfügbar“ – Songs bei Bedarf in Spotify in eine eigene Playlist kopieren.
Für Playlists braucht die App die Scopes `playlist-read-private` und `playlist-read-collaborative`
(wer sich vorher angemeldet hat, muss sich einmal neu anmelden).

## Hinweis zu Audio-Previews

Spotify liefert für Apps, die nach dem 27.11.2024 registriert wurden, keine `preview_url` mehr.
Das Backend sucht deshalb die 30-Sekunden-Preview über die öffentliche **Deezer-API** (per ISRC, sonst per
Artist + Titel) und streamt sie über `GET /api/games/:id/audio` an den Browser. Songs ohne gefundene Preview
werden beim Spielen automatisch übersprungen. Liefert Spotify doch eine `preview_url`, wird diese bevorzugt.

## Preview oder Anfang

Über den Umschalter im Player wählst du, was gespielt wird:

- **🔊 Preview** (Standard): die 30-Sekunden-Vorschau (siehe oben), meist aus der Songmitte. Snippets sind sample-genau.
- **📻 Anfang**: der echte Song ab 0:00 über das **Spotify Web Playback SDK**. Voraussetzungen:
  Spotify **Premium**, ein Desktop-Browser (Chrome, Firefox, Edge, Safari – mobile Browser werden vom SDK nicht unterstützt)
  und eine Anmeldung mit den Scopes `streaming`, `user-read-private`, `user-modify-playback-state`
  (wer sich vor diesem Update angemeldet hat, muss sich einmal neu anmelden – die App zeigt dafür einen Link).
  Start und Pause laufen über Spotify, dadurch sind sehr kurze Snippets (0,1 s / 0,5 s) spürbar ungenauer.
  Die Wiedergabe läuft über Spotify Connect: Andere Geräte des Accounts pausieren und zeigen ggf. den gespielten Titel an.

Ist Spotify verfügbar, ist „Anfang“ der Standard. Dann kommen auch Liked Songs dran, für die Deezer keine Preview hat (im Ergebnis-Fenster gibt es für diese Songs keine Wiedergabe). Ist „Anfang“ nicht möglich, fällt das Spiel automatisch auf die Preview zurück. Das gilt auch beim Abspielen: Startet Spotify nicht innerhalb von 5 s (bei „Gerät nicht gefunden“ nach einem automatischen zweiten Versuch), läuft derselbe Clip sofort als Preview weiter und das Spiel bleibt bis zum erneuten Wählen von „Anfang“ bei der Preview. Eine manuelle Auswahl wird im Browser gespeichert.

## API

| Methode | Route | Beschreibung |
|---|---|---|
| GET | `/api/auth/login` | Weiterleitung zu Spotify |
| GET | `/api/auth/callback` | Token-Tausch, User speichern, JWT → Frontend |
| GET | `/api/user/me` | User + Statistiken |
| GET | `/api/songs/search?q=` | Autocomplete in eigenen Songs |
| POST | `/api/songs/sync` | Manueller Sync aller ausgewählten Quellen |
| GET | `/api/playlists` | Playlists des Users + aktuelle Auswahl |
| PUT | `/api/playlists/selection` | `{ sourceIds }` – Quellen wählen (`liked` = Lieblingssongs), lädt Songs im Hintergrund |
| GET | `/api/games/active` | Laufendes Spiel fortsetzen |
| POST | `/api/games/start` | `{ spotify? }` – neues Spiel (mit Spotify auch Songs ohne Preview) |
| POST | `/api/games/play` | `{ session_id, duration }` – gehörte Snippet-Länge |
| POST | `/api/games/guess` | `{ session_id, guess, song_id? }` |
| POST | `/api/games/spotify-play` | `{ session_id, device_id }` – Song-Anfang im Web Playback SDK starten |
| GET | `/api/user/spotify-token` | Access Token fürs Web Playback SDK |
| POST | `/api/games/giveup` | `{ session_id }` – Runde aufgeben |
| POST | `/api/games/skip` | `{ session_id }` |
| GET | `/api/games/:id/audio` | Preview des aktuellen Songs |
| GET | `/api/games/highscores` | Top 10 |
| GET | `/api/games/history` | Eigene letzte Spiele |

## Deployment (Server + Vercel)

Das Backend läuft per PM2 auf einem Server, davor sitzt **Caddy** als Reverse Proxy mit automatischem
Let's-Encrypt-Zertifikat. Node selbst spricht nur HTTP auf `127.0.0.1:5000`.

1. **Hostname:** Bei <https://www.duckdns.org> einen kostenlosen Namen anlegen (z. B. `mein-guesser`) und die
   Server-IP eintragen – oder eine eigene Domain mit A-Record auf die IP.
2. **Firewall:** Ports 80 und 443 öffnen, Port 5000 geschlossen lassen
   (`sudo ufw allow 80,443/tcp`; ggf. zusätzlich in der Firewall des Hosters).
3. **Caddy installieren** (Debian/Ubuntu, siehe <https://caddyserver.com/docs/install>) und
   [`deploy/Caddyfile`](deploy/Caddyfile) nach `/etc/caddy/Caddyfile` kopieren, Namen anpassen,
   `sudo systemctl reload caddy`.
4. **`backend/.env` auf dem Server:**
   ```
   SPOTIFY_REDIRECT_URI=https://mein-guesser.duckdns.org/api/auth/callback
   FRONTEND_URL=https://spotify-guesser-pi.vercel.app
   NODE_ENV=production
   HOST=127.0.0.1
   ```
   danach `npm run build && pm2 restart spotify-guesser`.
5. **Spotify Dashboard:** Redirect URI `https://mein-guesser.duckdns.org/api/auth/callback` eintragen.
6. **Vercel:** `VITE_API_URL=https://mein-guesser.duckdns.org` (Production) setzen und neu deployen –
   Vite-Variablen werden beim Build eingebaut. [`frontend/vercel.json`](frontend/vercel.json) sorgt dafür,
   dass `/game`, `/auth/callback` usw. auch beim direkten Aufruf die App laden.
