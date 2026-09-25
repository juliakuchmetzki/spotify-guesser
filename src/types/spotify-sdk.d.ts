// Minimale Typen für das Spotify Web Playback SDK (https://sdk.scdn.co/spotify-player.js)
declare namespace Spotify {
  interface PlayerInit {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }
  interface PlaybackState {
    paused: boolean;
    position: number;
  }
  interface Error {
    message: string;
  }
  class Player {
    constructor(options: PlayerInit);
    connect(): Promise<boolean>;
    disconnect(): void;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    activateElement(): Promise<void>;
    addListener(event: 'ready' | 'not_ready', cb: (data: { device_id: string }) => void): boolean;
    addListener(event: 'player_state_changed', cb: (state: PlaybackState | null) => void): boolean;
    addListener(
      event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
      cb: (error: Error) => void,
    ): boolean;
  }
}

interface Window {
  Spotify?: typeof Spotify;
  onSpotifyWebPlaybackSDKReady?: () => void;
}
