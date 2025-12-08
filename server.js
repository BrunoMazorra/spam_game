import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { DEV_ROOM_ID } from './lib/constants.js';
import { GameLifecycle } from './lib/gameLifecycle.js';
import { roomStore } from './lib/roomStore.js';
import { ensureHostPlayer, ensurePlayerRecord, normalizeRoomId, sanitizeName, transferHostIfNeeded } from './lib/roomUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

function createAppServer() {
  roomStore.resetAll();
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  const lifecycle = new GameLifecycle(io);
  const log = (...args) => {
    // eslint-disable-next-line no-console
    console.log('[socket]', ...args);
  };

  app.use(express.static('public'));
  app.get(['/room/:roomId', '/room/:roomId/*'], (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  io.on('connection', (socket) => {
    log('connect', { socketId: socket.id });
    socket.on('create_room', ({ name, costPerPoint, durationSec, totalRounds, preferredId }, cb) => {
      log('create_room', { socketId: socket.id, preferredId, costPerPoint, durationSec, totalRounds });
      if (roomStore.hasInProgressGame()) {
        return cb?.({ ok: false, error: 'A game is already in progress. Please wait for it to finish.' });
      }
      const room = roomStore.createRoom({ hostSocketId: socket.id, hostName: name, costPerPoint, durationSec, totalRounds, preferredId });
      if (!room) {
        return cb?.({ ok: false, error: 'Unable to create room (ID collision or game in progress).' });
      }
      socket.join(room.id);
      cb?.({ ok: true, roomId: room.id, settings: room.settings });
      lifecycle.emitLobby(room.id);
    });

    socket.on('join_room', ({ roomId, name }, cb) => {
      const requestedRoomId = normalizeRoomId(roomId);
      const room = requestedRoomId ? roomStore.get(requestedRoomId) : roomStore.getOrCreateDevRoom();
      if (!room) return cb?.({ ok: false, error: 'Room not found' });
      ensureHostPlayer(room);
      if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Game already started or in progress' });
      if (!room.players.has(socket.id)) {
        ensurePlayerRecord(room, socket.id, { name: sanitizeName(name, 'Player'), socketId: socket.id });
      }
      socket.join(room.id);
      log('join_room', { socketId: socket.id, roomId: room.id, status: room.status, players: room.players.size });
      cb?.({ ok: true, roomId: room.id, settings: room.settings });
      lifecycle.emitLobby(room.id);
      if (room.readyToStart?.size > 0) {
        io.to(room.id).emit('ready_to_start_status', { readyCount: room.readyToStart.size, totalPlayers: room.players.size });
      }
    });

    socket.on('ready_to_start', ({ roomId }, cb) => {
      const room = roomStore.get(roomId);
      if (!room) return cb?.({ ok: false, error: 'Room not found' });
      ensureHostPlayer(room);
      if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Not in lobby' });
      if (!room.players.has(socket.id)) return cb?.({ ok: false, error: 'Not in room' });
      if (room.players.size < 2) return cb?.({ ok: false, error: 'Need at least 2 players to ready' });
      if (!room.readyToStart) room.readyToStart = new Set();
      room.readyToStart.add(socket.id);
      const payload = { readyCount: room.readyToStart.size, totalPlayers: room.players.size };
      log('ready_to_start', { roomId, socketId: socket.id, payload, status: room.status });
      cb?.({ ok: true, ...payload });
      io.to(room.id).emit('ready_to_start_status', payload);
      if (room.readyToStart.size >= room.players.size) {
        lifecycle.startRound(room.id);
      }
    });

    socket.on('start_game', ({ roomId }, cb) => {
      const room = roomStore.get(roomId);
      if (!room) return cb?.({ ok: false, error: 'Room not found' });
      if (room.hostSocketId !== socket.id) return cb?.({ ok: false, error: 'Only host can start' });
      if (room.status === 'running' || room.status === 'countdown') return cb?.({ ok: false, error: 'Game already running or counting down' });
      if (room.players.size < 2) return cb?.({ ok: false, error: 'Need at least 2 players' });
      if (room.status === 'revealed' || room.status === 'finished') {
        roomStore.resetRoomToLobby(room);
        lifecycle.emitLobby(room.id);
      }
      log('start_game', { roomId, host: socket.id, players: room.players.size, status: room.status });
      lifecycle.startRound(room.id);
      cb?.({ ok: true });
    });

    socket.on('submit_points', ({ roomId, points }, cb) => {
      const res = lifecycle.recordSubmission(roomId, socket.id, points);
      log('submit_points', {
        roomId,
        socketId: socket.id,
        ok: res?.ok,
        error: res?.error,
        points: Array.isArray(points) ? points.length : 0
      });
      cb?.(res);
      if (res.ok) {
        io.to(socket.id).emit('submitted', { roomId, points: res.points });
      }
    });

    socket.on('set_name', ({ roomId, name }, cb) => {
      const room = roomStore.get(roomId);
      if (!room) return cb?.({ ok: false, error: 'Room not found' });
      const player = ensurePlayerRecord(room, socket.id);
      if (!player) return cb?.({ ok: false, error: 'Not in room' });
      const updatedName = sanitizeName(name, player.id === room.hostSocketId ? 'Host' : 'Player');
      player.name = updatedName;
      if (player.id === room.hostSocketId) {
        room.hostName = updatedName;
      }
      lifecycle.emitLobby(room.id);
      cb?.({ ok: true, name: updatedName, emoji: player.emoji });
    });

    socket.on('leave_room', ({ roomId }) => {
      const room = roomStore.get(roomId);
      if (!room) return;
      log('leave_room', { socketId: socket.id, roomId });
      roomStore.prunePlayer(room, socket.id);
      socket.leave(room.id);
      lifecycle.emitLobby(room.id);
    });

    socket.on('disconnect', () => {
      log('disconnect', { socketId: socket.id });
      for (const room of roomStore.rooms.values()) {
        if (room.players.has(socket.id)) {
          if (room.status === 'running') {
            // Defer pruning until results are emitted so scores still show up.
            if (!room.pendingPrune) room.pendingPrune = new Set();
            room.pendingPrune.add(socket.id);
            room.readyNext.delete(socket.id);
            room.readyToStart?.delete?.(socket.id);
          } else if (room.status === 'revealed') {
            // Safe to remove now but keep totals so results and winner stay accurate.
            roomStore.prunePlayer(room, socket.id, { keepTotals: true });
            transferHostIfNeeded(room);
            io.to(room.id).emit('ready_status', { readyCount: room.readyNext.size, totalPlayers: room.players.size });
          } else {
            roomStore.prunePlayer(room, socket.id);
            transferHostIfNeeded(room);
            lifecycle.emitLobby(room.id);
          }
        }
      }
    });

    socket.on('ready_next', ({ roomId }, cb) => {
      const room = roomStore.get(roomId);
      if (!room) return cb?.({ ok: false, error: 'Room not found' });
      ensureHostPlayer(room);
      if (room.status === 'running') return cb?.({ ok: true, info: 'Round already started' });
      if (room.status !== 'revealed') return cb?.({ ok: false, error: 'Not in revealed state' });
      if (!room.players.has(socket.id)) return cb?.({ ok: false, error: 'Not in room' });
      room.readyNext.add(socket.id);
      const payload = { readyCount: room.readyNext.size, totalPlayers: room.players.size };
      cb?.({ ok: true, ...payload });
      io.to(room.id).emit('ready_status', payload);
      if (room.readyNext.size >= room.players.size) {
        if (room.currentRound >= room.settings.totalRounds) {
          const totalsArray = Array.from(room.players.values()).map((p) => ({
            playerId: p.id,
            name: p.name,
            color: p.color,
            emoji: p.emoji,
            totalPayoff: room.totals.get(p.id) || 0
          }));
          totalsArray.sort((a, b) => b.totalPayoff - a.totalPayoff);
          const matchWinner = totalsArray[0] || null;
          io.to(room.id).emit('match_finished', { totals: totalsArray, totalRounds: room.settings.totalRounds, winner: matchWinner });
          room.status = 'finished';
        } else {
          lifecycle.startRound(room.id);
        }
      }
    });
  });

  return { app, server, io, lifecycle };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createAppServer();
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Spam Game server listening on http://localhost:${PORT}`);
    roomStore.getOrCreateDevRoom();
  });
}

export { createAppServer };
