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
// Give a slightly longer grace window after the timer to catch last-millisecond submissions.
export const AUTO_SUBMIT_DELAY_MS = 800;
// Allow a small late-arrival buffer beyond the auto-submit delay for client/server clock skew.
export const SUBMISSION_LATE_GRACE_MS = 500;
export const RESULTS_GRACE_MS = 60_000;
