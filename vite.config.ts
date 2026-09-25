import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 127.0.0.1 statt localhost, passend zur Spotify-Redirect-URI (localhost ist dort nicht erlaubt)
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
});
