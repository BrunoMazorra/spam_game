import { DEFAULT_SETTINGS, DEV_ROOM_ID } from './constants.js';
import { clearRoomTimers, ensureHostPlayer, ensurePlayerRecord, generateRoomId, normalizeRoomId, nowMs, sanitizeName, transferHostIfNeeded } from './roomUtils.js';

class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  createRoom({ hostSocketId, hostName, costPerPoint, durationSec, totalRounds, preferredId }) {
    const preferred = normalizeRoomId(preferredId);
    const id = preferred || generateRoomId(this.rooms);
    const resolvedHostName = sanitizeName(hostName, 'Host');
    const room = {
      id,
      createdAt: nowMs(),
      hostSocketId,
      hostName: resolvedHostName,
      settings: {
        costPerPoint: Number(costPerPoint ?? DEFAULT_SETTINGS.costPerPoint),
        durationSec: Number(durationSec ?? DEFAULT_SETTINGS.durationSec),
        totalRounds: Number(totalRounds ?? DEFAULT_SETTINGS.totalRounds)
      },
      status: 'lobby',
      players: new Map(),
      submissions: new Map(),
      startedAt: undefined,
      revealAt: undefined,
      timer: undefined,
      countdownInterval: undefined,
      finishTimer: undefined,
      currentRound: 0,
      totals: new Map(),
      readyNext: new Set(),
      readyToStart: new Set()
    };
    this.rooms.set(id, room);
    const hostId = hostSocketId;
    ensurePlayerRecord(room, hostId, { name: resolvedHostName, socketId: hostSocketId });
    return room;
  }

  getOrCreateDevRoom() {
    let room = this.rooms.get(DEV_ROOM_ID);
    if (!room) {
      room = {
        id: DEV_ROOM_ID,
        createdAt: nowMs(),
        hostSocketId: null,
        hostName: 'Host',
        settings: { ...DEFAULT_SETTINGS },
        status: 'lobby',
        players: new Map(),
        submissions: new Map(),
        startedAt: undefined,
        revealAt: undefined,
        timer: undefined,
        countdownInterval: undefined,
        finishTimer: undefined,
        currentRound: 0,
        totals: new Map(),
        readyNext: new Set(),
        readyToStart: new Set()
      };
      this.rooms.set(DEV_ROOM_ID, room);
    } else if (room.status === 'finished' || room.status === 'revealed') {
      this.resetRoomToLobby(room);
    }
    if (!room.hostName) {
      room.hostName = 'Host';
    }
    return room;
  }

  get(roomId) {
    const rid = normalizeRoomId(roomId);
    if (!rid) return null;
    if (rid === DEV_ROOM_ID) return this.getOrCreateDevRoom();
    return this.rooms.get(rid) || null;
  }

  resetRoomToLobby(room) {
    if (!room) return;
    room.status = 'lobby';
    room.currentRound = 0;
    room.submissions.clear();
    room.readyNext.clear();
    room.readyToStart?.clear?.();
    clearRoomTimers(room);
    ensureHostPlayer(room);
  }

  prunePlayer(room, playerId) {
    if (!room) return;
    room.players.delete(playerId);
    room.submissions.delete(playerId);
    room.totals.delete(playerId);
    room.readyNext.delete(playerId);
    room.readyToStart?.delete?.(playerId);
    if (room.hostSocketId === playerId) {
      room.hostSocketId = null;
      room.hostName = 'Host';
      transferHostIfNeeded(room);
    }
  }
}

export const roomStore = new RoomStore();
