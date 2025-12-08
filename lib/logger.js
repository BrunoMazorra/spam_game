import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function safeRoomId(roomId) {
  const fallback = 'global';
  if (!roomId) return fallback;
  const cleaned = roomId.toString().replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || fallback;
}

export function logEvent(event, payload = {}) {
  try {
    ensureLogDir();
    const ts = new Date().toISOString();
    const line = `[${ts}] ${event} ${JSON.stringify(payload)}\n`;
    const targetRoom = safeRoomId(payload.roomId);
    const filePath = path.join(LOG_DIR, `${targetRoom}.log`);
    fs.appendFileSync(filePath, line, 'utf8');
    // Still mirror to console for quick visibility.
    // eslint-disable-next-line no-console
    console.log(`[${ts}] ${event}`, JSON.stringify(payload));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('logEvent failed', err);
  }
}
