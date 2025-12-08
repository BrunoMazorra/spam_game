import { DEFAULT_SETTINGS, DEV_ROOM_ID } from './constants.js';
import { clearRoomTimers, ensureHostPlayer, ensurePlayerRecord, generateRoomId, normalizeRoomId, nowMs, sanitizeName, transferHostIfNeeded } from './roomUtils.js';

class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  resetAll() {
    for (const room of this.rooms.values()) {
      clearRoomTimers(room);
    }
    this.rooms.clear();
  }

  createRoom({ hostSocketId, hostName, costPerPoint, durationSec, totalRounds, preferredId }) {
    if (this.hasInProgressGame()) {
      return null;
    }
    const preferred = normalizeRoomId(preferredId);
    const id = preferred || generateRoomId(this.rooms);
    const existing = this.rooms.get(id);
    if (existing) {
      if (this.isRoomActive(existing)) {
        return null;
      }
      this.resetRoomToLobby(existing);
      existing.hostSocketId = hostSocketId;
      existing.hostName = sanitizeName(hostName, 'Host');
      existing.settings = {
        costPerPoint: Number(costPerPoint ?? DEFAULT_SETTINGS.costPerPoint),
        durationSec: Number(durationSec ?? DEFAULT_SETTINGS.durationSec),
        totalRounds: Number(totalRounds ?? DEFAULT_SETTINGS.totalRounds)
      };
      ensurePlayerRecord(existing, hostSocketId, { name: existing.hostName, socketId: hostSocketId });
      return existing;
    }
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
      readyToStart: new Set(),
      pendingPrune: new Set()
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
        readyToStart: new Set(),
        pendingPrune: new Set()
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
    room.totals.clear();
    room.readyNext.clear();
    room.readyToStart?.clear?.();
    room.pendingPrune?.clear?.();
    room.startedAt = undefined;
    room.revealAt = undefined;
    clearRoomTimers(room);
    ensureHostPlayer(room);
  }

  hasInProgressGame() {
    for (const r of this.rooms.values()) {
      if (this.isRoomActive(r)) {
        return true;
      }
    }
    return false;
  }

  isRoomActive(room) {
    return room.status === 'countdown' || room.status === 'running';
  }

  listPublicRooms() {
    const rooms = [];
    for (const room of this.rooms.values()) {
      if (!room) continue;
      if (room.id === DEV_ROOM_ID) continue;
      if (room.status !== 'lobby') continue;
      rooms.push({
        id: room.id,
        players: room.players.size,
        createdAt: room.createdAt,
        status: room.status,
        settings: room.settings
      });
    }
    rooms.sort((a, b) => b.createdAt - a.createdAt);
    return rooms;
  }

  prunePlayer(room, playerId, { keepTotals = false } = {}) {
    if (!room) return;
    room.players.delete(playerId);
    room.submissions.delete(playerId);
    if (!keepTotals) {
      room.totals.delete(playerId);
    }
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
