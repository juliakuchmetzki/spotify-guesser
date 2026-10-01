import 'dotenv/config';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import './database';
import { requireAuth } from './middleware/auth';
import authRoutes from './routes/auth';
import gameRoutes from './routes/games';
import playlistRoutes from './routes/playlists';
import songRoutes from './routes/songs';
import userRoutes from './routes/user';
import { startSyncScheduler } from './sync';

for (const name of ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI', 'JWT_SECRET']) {
  if (!process.env[name] || process.env[name]!.startsWith('xxxx')) {
    console.warn(`⚠️  ${name} ist nicht gesetzt – bitte backend/.env ausfüllen (siehe .env.example)`);
  }
}

const PORT = Number(process.env.PORT ?? 5000);
// Hinter einem Reverse Proxy (Caddy) auf 127.0.0.1 setzen, damit Port 5000 nicht öffentlich erreichbar ist
const HOST = process.env.HOST ?? '0.0.0.0';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://127.0.0.1:3000';

const app = express();
// HTTPS terminiert im Reverse Proxy (Caddy); dessen X-Forwarded-*-Header vertrauen
app.set('trust proxy', 'loopback');
// localhost und 127.0.0.1 sind für den Browser unterschiedliche Origins – beide erlauben
app.use(cors({ origin: [frontendUrl, frontendUrl.replace('127.0.0.1', 'localhost'), frontendUrl.replace('localhost', '127.0.0.1')] }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRoutes);
app.use('/api/playlists', requireAuth, playlistRoutes);
app.use('/api/games', requireAuth, gameRoutes);
app.use('/api/songs', requireAuth, songRoutes);
app.use('/api/user', requireAuth, userRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Nicht gefunden' });
});
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // z. B. ungültiges JSON im Request-Body
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

startSyncScheduler();
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`❌ Port ${PORT} konnte nicht geöffnet werden:`, err.message);
    process.exit(1);
  }
  console.log(`🎵 Backend läuft auf http://${HOST}:${PORT}`);
});
