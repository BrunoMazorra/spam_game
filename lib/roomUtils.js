import { nanoid } from 'nanoid';
import { AUTO_SUBMIT_DELAY_MS, PALETTE, PLAYER_EMOJIS, ROOM_ID_LENGTH } from './constants.js';

export function nowMs() {
  return Date.now();
}

export function sanitizeName(raw, fallback = 'Player') {
  const cleaned = (raw ?? '').toString().trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 32);
}

export function normalizeRoomId(roomId) {
  return (roomId ?? '').toString().trim().toUpperCase();
}

export function generateRoomId(rooms) {
  let id = '';
  do {
    id = nanoid(ROOM_ID_LENGTH).toUpperCase();
  } while (rooms.has(id));
  return id;
}

export function pickColor(index) {
  return PALETTE[index % PALETTE.length];
}

export function pickEmoji(room) {
  const used = new Set(Array.from(room.players.values()).map((p) => p.emoji).filter(Boolean));
  const pool = PLAYER_EMOJIS.filter((e) => !used.has(e));
  const base = pool.length > 0 ? pool : PLAYER_EMOJIS;
  return base[Math.floor(Math.random() * base.length)];
}

export function ensurePlayerRecord(room, playerId, { name, socketId } = {}) {
  if (!room || !playerId) return null;
  if (!room.players.has(playerId)) {
    const color = pickColor(room.players.size);
    const emoji = pickEmoji(room);
    const fallback = playerId === room.hostSocketId ? room.hostName || 'Host' : 'Player';
    const resolvedName = sanitizeName(name, fallback);
    room.players.set(playerId, {
      id: playerId,
      name: resolvedName,
      color,
      emoji,
      socketId: socketId || playerId
    });
  } else {
    const player = room.players.get(playerId);
    if (!player.emoji) {
      player.emoji = pickEmoji(room);
    }
  }
  room.totals.set(playerId, room.totals.get(playerId) || 0);
  return room.players.get(playerId);
}

export function ensureHostPlayer(room) {
  if (!room || !room.hostSocketId) return null;
  return ensurePlayerRecord(room, room.hostSocketId, { name: room.hostName || 'Host', socketId: room.hostSocketId });
}

export function transferHostIfNeeded(room) {
  if (!room) return;
  if (room.hostSocketId && room.players.has(room.hostSocketId)) return;
  const next = room.players.keys().next();
  if (!next || next.done) {
    room.hostSocketId = null;
    room.hostName = 'Host';
    return;
  }
  const newHostId = next.value;
  room.hostSocketId = newHostId;
  const newHost = room.players.get(newHostId);
  if (newHost) {
    room.hostName = newHost.name || 'Host';
  }
  ensureHostPlayer(room);
}

export function sanitizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  const clamped = raw
    .map(Number)
    .filter((x) => Number.isFinite(x))
    .map((x) => Math.min(1, Math.max(0, x)));
  clamped.sort((a, b) => a - b);
  const eps = 1e-9;
  const unique = [];
  for (const x of clamped) {
    if (unique.length === 0 || Math.abs(x - unique[unique.length - 1]) > eps) {
      unique.push(x);
    }
  }
  return unique;
}

export function computeResults(room) {
  const cost = room.settings.costPerPoint;
  const allPoints = [];
  for (const [playerId, pts] of room.submissions.entries()) {
    for (const x of pts) {
      allPoints.push({ x, playerId });
    }
  }
  allPoints.sort((a, b) => a.x - b.x);

  const playerArea = new Map();
  for (let i = 0; i < allPoints.length; i++) {
    const left = allPoints[i];
    const right = allPoints[i + 1];
    const intervalEnd = right ? right.x : 1;
    const width = Math.max(0, intervalEnd - left.x);
    if (width <= 0) continue;
    playerArea.set(left.playerId, (playerArea.get(left.playerId) || 0) + width);
  }

  const results = [];
  for (const [playerId, player] of room.players.entries()) {
    const pts = room.submissions.get(playerId) || [];
    const area = playerArea.get(playerId) || 0;
    const costPaid = cost * pts.length;
    const payoff = area - costPaid;
    results.push({
      playerId,
      name: player.name,
      color: player.color,
      emoji: player.emoji,
      points: pts,
      area,
      cost: costPaid,
      payoff
    });
  }

  results.sort((a, b) => b.payoff - a.payoff);
  const winner = results[0] || null;
  return { results, winner };
}

export function clearRoomTimers(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = undefined;
  }
  if (room.countdownInterval) {
    clearInterval(room.countdownInterval);
    room.countdownInterval = undefined;
  }
  if (room.finishTimer) {
    clearTimeout(room.finishTimer);
    room.finishTimer = undefined;
  }
}

export function scheduleAutoSubmit(fn) {
  return setTimeout(fn, AUTO_SUBMIT_DELAY_MS);
}
