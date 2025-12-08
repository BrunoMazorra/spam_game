export const ROOM_ID_LENGTH = 6;
export const DEV_ROOM_ID = '0';

export const DEFAULT_SETTINGS = {
  costPerPoint: 0.05,
  durationSec: 10,
  // Single-game mode: always one round
  totalRounds: 1
};

export const PALETTE = [
  '#e6194B',
  '#0082c8',
  '#3cb44b',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#d2f53c',
  '#fabebe',
  '#008080',
  '#e6beff',
  '#aa6e28',
  '#800000',
  '#aaffc3',
  '#808000',
  '#ffd8b1',
  '#000080',
  '#808080',
  '#FFFFFF',
  '#000000'
];

export const PLAYER_EMOJIS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🐧', '🦄', '🐯', '🐰', '🐙', '🐝', '🐢', '🐞', '🦁', '🦉'];

export const COUNTDOWN_START = 3;
// Short buffer after timer purely for server-side auto-submit dispatch.
export const AUTO_SUBMIT_DELAY_MS = 200;
// Allow small, bounded jitter for client-submitted timestamps that landed before reveal.
export const CLIENT_SUBMIT_JITTER_MS = 600;
export const RESULTS_GRACE_MS = 60_000;
