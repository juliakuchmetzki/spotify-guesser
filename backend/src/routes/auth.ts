import crypto from 'node:crypto';
import { Router } from 'express';
import { get, run, type UserRow } from '../database';
import { signToken } from '../middleware/auth';
import { exchangeCode, getAuthorizeUrl, getMe, SpotifyError } from '../spotify';
import { syncUser } from '../sync';

const router = Router();
const STATE_TTL_MS = 10 * 60_000;
const RESYNC_AFTER_MS = 6 * 60 * 60_000;
const pendingStates = new Map<string, number>(); // state → Ablaufzeit (CSRF-Schutz)

const frontendUrl = () => process.env.FRONTEND_URL ?? 'http://127.0.0.1:3000';

router.get('/login', (_req, res) => {
  const now = Date.now();
  for (const [state, expires] of pendingStates) if (expires < now) pendingStates.delete(state);

  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, now + STATE_TTL_MS);
  res.redirect(getAuthorizeUrl(state));
});

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const fail = (message: string) => res.redirect(`${frontendUrl()}/login?error=${encodeURIComponent(message)}`);

  if (error) return fail(error === 'access_denied' ? 'Anmeldung abgebrochen' : error);

  const expires = state ? pendingStates.get(state) : undefined;
  if (state) pendingStates.delete(state);
  if (!code || !expires || expires < Date.now()) {
    return fail('Ungültige oder abgelaufene Anmeldung – bitte erneut versuchen');
  }

  try {
    const tokens = await exchangeCode(code);
    const profile = await getMe(tokens.access_token);

    run(
      `INSERT INTO users (spotify_id, display_name, email, access_token, refresh_token, token_expires_at, scopes, product)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (spotify_id) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, users.refresh_token),
         token_expires_at = excluded.token_expires_at,
         scopes = excluded.scopes,
         product = excluded.product`,
      profile.id,
      profile.display_name,
      profile.email ?? null,
      tokens.access_token,
      tokens.refresh_token ?? null,
      Date.now() + tokens.expires_in * 1000,
      tokens.scope ?? null,
      profile.product ?? null,
    );
    const user = get<UserRow>('SELECT * FROM users WHERE spotify_id = ?', profile.id)!;

    // Erster Login (oder lange her): Songs direkt im Hintergrund laden, nicht erst um Mitternacht
    const lastSync = user.last_sync ? Date.parse(`${user.last_sync}Z`) : 0;
    if (Date.now() - lastSync > RESYNC_AFTER_MS) {
      syncUser(user.id).catch((err) => console.error(`[sync] User ${user.id}:`, (err as Error).message));
    }

    // Token im Fragment, damit er nicht in Server-Logs oder Referrer-Headern landet
    res.redirect(`${frontendUrl()}/auth/callback#token=${signToken(user.id)}`);
  } catch (err) {
    console.error('[auth] Callback fehlgeschlagen:', (err as Error).message);
    if (err instanceof SpotifyError && err.status === 403) {
      return fail('Dein Spotify-Account ist für diese App nicht freigeschaltet (Developer Dashboard → User Management).');
    }
    fail('Spotify-Anmeldung fehlgeschlagen');
  }
});

export default router;
