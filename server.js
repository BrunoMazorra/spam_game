import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.get(['/room/:roomId', '/room/:roomId/*'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Game state in-memory. Suitable for prototypes and small rooms.
 * Each room id maps to a session object with players, settings, and lifecycle.
 */
const rooms = new Map();
const ROOM_ID_LENGTH = 6;
const DEV_ROOM_ID = '0';

function normalizeRoomId(roomId) {
  return (roomId ?? '').toString().trim().toUpperCase();
}

function generateRoomId() {
  let id = '';
  do {
    id = nanoid(ROOM_ID_LENGTH).toUpperCase();
  } while (rooms.has(id));
  return id;
}

function nowMs() {
  return Date.now();
}

function createRoom({ hostSocketId, hostName, costPerPoint, durationSec, totalRounds, preferredId }) {
  const preferred = normalizeRoomId(preferredId);
  const id = preferred || generateRoomId();
  const room = {
    id,
    createdAt: nowMs(),
    hostSocketId,
    settings: {
      costPerPoint: Number(costPerPoint ?? 0.05),
      durationSec: Number(durationSec ?? 10),
      totalRounds: Number(totalRounds ?? 2)
    },
    status: 'lobby', // lobby | running | revealed | finished
    // playerId => { id, name, color, socketId, submittedAt?, points? }
    players: new Map(),
    // submission cache during running phase: playerId => [numbers]
    submissions: new Map(),
    startedAt: undefined,
    revealAt: undefined,
    timer: undefined,
    countdownInterval: undefined,
    currentRound: 0,
    totals: new Map(),
    readyNext: new Set()
  };
  rooms.set(id, room);
  // add host as first player
  const hostId = hostSocketId;
  const hostColor = pickColor(room.players.size);
  room.players.set(hostId, {
    id: hostId,
    name: hostName || 'Host',
    color: hostColor,
    socketId: hostSocketId
  });
  room.totals.set(hostId, 0);
  return room;
}

function getOrCreateRoom0() {
  // Always ensure dev room exists for quick local testing
  let room = rooms.get(DEV_ROOM_ID);
  if (!room) {
    // Create room "0" with default settings (no host yet)
    room = {
      id: DEV_ROOM_ID,
      createdAt: nowMs(),
      hostSocketId: null,
      settings: {
        costPerPoint: 0.05,
        durationSec: 10,
        totalRounds: 2
      },
      status: 'lobby',
      players: new Map(),
      submissions: new Map(),
      startedAt: undefined,
      revealAt: undefined,
      timer: undefined,
      countdownInterval: undefined,
      currentRound: 0,
      totals: new Map(),
      readyNext: new Set()
    };
    rooms.set(DEV_ROOM_ID, room);
    console.log('[Server] Room "0" created');
  } else if (room.status === 'finished' || room.status === 'revealed') {
    // Reset room "0" if it's finished - allow reuse for testing
    console.log('[Server] Resetting room "0" from', room.status, 'to lobby');
    room.status = 'lobby';
    room.currentRound = 0;
    room.submissions.clear();
    room.readyNext.clear();
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = undefined;
    }
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = undefined;
    }
  }
  return room;
}

function getRoomById(roomId) {
  const rid = normalizeRoomId(roomId);
  if (!rid) return null;
  if (rid === DEV_ROOM_ID) return getOrCreateRoom0();
  return rooms.get(rid);
}

function pickColor(index) {
  // Preferred ordering: Host = red, first joiner = blue, then others
  const palette = [
    '#e6194B', // red
    '#0082c8', // blue
    '#3cb44b', // green
    '#f58231', '#911eb4', '#46f0f0', '#f032e6',
    '#d2f53c', '#fabebe', '#008080', '#e6beff', '#aa6e28', '#800000', '#aaffc3',
    '#808000', '#ffd8b1', '#000080', '#808080', '#FFFFFF', '#000000'
  ];
  return palette[index % palette.length];
}

function sanitizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  const clamped = raw
    .map(Number)
    .filter((x) => Number.isFinite(x))
    .map((x) => Math.min(1, Math.max(0, x)));
  clamped.sort((a, b) => a - b);
  // remove duplicates within small epsilon
  const eps = 1e-9;
  const unique = [];
  for (const x of clamped) {
    if (unique.length === 0 || Math.abs(x - unique[unique.length - 1]) > eps) {
      unique.push(x);
    }
  }
  return unique;
}

function computeResults(room) {
  const cost = room.settings.costPerPoint;
  // Build union of points with ownership info
  const allPoints = [];
  for (const [playerId, pts] of room.submissions.entries()) {
    for (const x of pts) {
      allPoints.push({ x, playerId });
    }
  }
  allPoints.sort((a, b) => a.x - b.x);

  // Compute areas: interval [x_i, x_{i+1}) goes to owner of left point.
  // The last point gets [x_last, 1]. The initial [0, firstPoint) is unowned by rule.
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

io.on('connection', (socket) => {
  socket.on('create_room', ({ name, costPerPoint, durationSec }, cb) => {
    const room = createRoom({ hostSocketId: socket.id, hostName: name, costPerPoint, durationSec });
    socket.join(room.id);
    cb?.({ ok: true, roomId: room.id, settings: room.settings });
    emitLobby(room.id);
  });

  socket.on('join_room', ({ roomId, name }, cb) => {
    console.log(`[Join Room] Request: raw roomId="${roomId}", name="${name}", socketId="${socket.id}"`);
    const requestedRoomId = normalizeRoomId(roomId);
    console.log(`[Join Room] Processed roomId: "${requestedRoomId}"`);

    let room;
    if (!requestedRoomId || requestedRoomId === DEV_ROOM_ID) {
      console.log('[Join Room] Using dev room "0" for empty or dev ID');
      room = getOrCreateRoom0();
      if (room.status === 'finished' || room.status === 'revealed') {
        console.log(`[Join Room] Resetting room "0" from ${room.status} to lobby`);
        room.status = 'lobby';
        room.currentRound = 0;
        room.submissions.clear();
        room.readyNext.clear();
        if (room.timer) {
          clearTimeout(room.timer);
          room.timer = undefined;
        }
        if (room.countdownInterval) {
          clearInterval(room.countdownInterval);
          room.countdownInterval = undefined;
        }
      }
    } else {
      room = rooms.get(requestedRoomId);
    }

    if (!room) {
      console.log(`[Join Room] Room "${requestedRoomId}" not found`);
      return cb?.({ ok: false, error: 'Room not found' });
    }
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Game already started' });
    if (room.players.has(socket.id)) return cb?.({ ok: true, roomId: room.id, settings: room.settings });

    const color = pickColor(room.players.size);
    room.players.set(socket.id, { id: socket.id, name: name || 'Player', color, socketId: socket.id });
    room.totals.set(socket.id, room.totals.get(socket.id) || 0);
    socket.join(room.id);
    console.log(`[Join Room] Player ${socket.id} (${name || 'Player'}) joined room "${room.id}"`);
    cb?.({ ok: true, roomId: room.id, settings: room.settings });
    emitLobby(room.id);
    // Emit current ready status to all players
    if (room.readyNext.size > 0) {
      io.to(room.id).emit('ready_to_start_status', { readyCount: room.readyNext.size, totalPlayers: room.players.size });
    }
  });

  socket.on('ready_to_start', ({ roomId }, cb) => {
    const room = getRoomById(roomId);
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    if (room.status !== 'lobby') {
      console.log(`[Room ${room.id}] Player ${socket.id} tried to ready but status is ${room.status}`);
      return cb?.({ ok: false, error: 'Not in lobby' });
    }
    if (!room.players.has(socket.id)) return cb?.({ ok: false, error: 'Not in room' });
    if (room.readyNext.has(socket.id)) {
      // Already ready, just return current status
      return cb?.({ ok: true, readyCount: room.readyNext.size, totalPlayers: room.players.size });
    }
    room.readyNext.add(socket.id);
    console.log(`[Room ${room.id}] Player ${socket.id} is ready. Ready: ${room.readyNext.size}/${room.players.size}`);
    cb?.({ ok: true, readyCount: room.readyNext.size, totalPlayers: room.players.size });
    io.to(room.id).emit('ready_to_start_status', { readyCount: room.readyNext.size, totalPlayers: room.players.size });
    // If all players are ready, start the game automatically
    if (room.readyNext.size >= room.players.size) {
      console.log(`[Room ${room.id}] All players ready! Starting game...`);
      startGameRound(room.id);
    }
  });

  function startGameRound(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
      console.log(`[Room ${roomId}] Room not found in startGameRound`);
      return;
    }
    if (room.status !== 'lobby') {
      console.log(`[Room ${room.id}] Cannot start game - status is ${room.status}, not lobby`);
      return;
    }
    console.log(`[Room ${room.id}] Starting game round ${(room.currentRound || 0) + 1}`);
    // Clear any existing timer and countdown interval
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = undefined;
    }
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = undefined;
    }
    room.currentRound = (room.currentRound || 0) + 1;
    room.readyNext.clear();
    // Emit countdown first
    let countdown = 3;
    console.log(`[Room ${room.id}] Emitting countdown: ${countdown}`);
    io.to(room.id).emit('countdown', { countdown });
    room.countdownInterval = setInterval(() => {
      countdown--;
      console.log(`[Room ${room.id}] Countdown: ${countdown}`);
      if (countdown > 0) {
        io.to(room.id).emit('countdown', { countdown });
      } else {
        clearInterval(room.countdownInterval);
        room.countdownInterval = undefined;
        // Start the game after countdown
        console.log(`[Room ${room.id}] Countdown finished, starting game...`);
        room.status = 'running';
        room.startedAt = nowMs();
        room.revealAt = room.startedAt + room.settings.durationSec * 1000;
        room.submissions.clear(); // Clear previous submissions
        const delay = room.revealAt - nowMs();
        console.log(`[Room ${room.id}] Game started. Round ${room.currentRound}/${room.settings.totalRounds}. Will end in ${delay}ms`);
        const gameStartedData = { 
          startedAt: room.startedAt, 
          revealAt: room.revealAt, 
          settings: room.settings, 
          currentRound: room.currentRound, 
          totalRounds: room.settings.totalRounds 
        };
        console.log(`[Room ${room.id}] Emitting game_started event:`, gameStartedData);
        io.to(room.id).emit('game_started', gameStartedData);
        // End timer
        room.timer = setTimeout(() => endGame(room.id), delay);
      }
    }, 1000);
  }

  socket.on('start_game', ({ roomId }, cb) => {
    const room = getRoomById(roomId);
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    if (room.hostSocketId !== socket.id) return cb?.({ ok: false, error: 'Only host can start' });
    if (room.status === 'running') return cb?.({ ok: false, error: 'Game already running' });
    if (room.players.size < 1) return cb?.({ ok: false, error: 'Need at least 1 player' });
    // Allow restarting from revealed/finished status - reset to lobby first
    if (room.status === 'revealed' || room.status === 'finished') {
      room.status = 'lobby';
      emitLobby(room.id);
    }
    if (room.status !== 'lobby') return cb?.({ ok: false, error: 'Cannot start from current state' });
    // Use the shared startGameRound function
    startGameRound(room.id);
    cb?.({ ok: true });
  });

  socket.on('submit_points', ({ roomId, points }, cb) => {
    const room = getRoomById(roomId);
    if (!room) {
      console.log(`[Submit Points] Room not found: "${roomId}"`);
      return cb?.({ ok: false, error: 'Room not found' });
    }
    if (room.status !== 'running') {
      console.log(`[Submit Points] Room ${room.id} status is ${room.status}, not accepting submissions`);
      return cb?.({ ok: false, error: 'Not accepting submissions' });
    }
    if (!room.players.has(socket.id)) {
      console.log(`[Submit Points] Socket ${socket.id} not in room ${room.id}. Players:`, Array.from(room.players.keys()));
      return cb?.({ ok: false, error: 'Not in room' });
    }
    const clean = sanitizePoints(points);
    const player = room.players.get(socket.id);
    console.log(`[Submit Points] Player ${player?.name || socket.id} (${socket.id}) submitting ${clean.length} points in room ${room.id}`);
    console.log(`[Submit Points] Points array:`, clean);
    // IMPORTANT: Always set the submission, even if it's empty
    room.submissions.set(socket.id, clean);
    console.log(`[Submit Points] Submission SET for ${player?.name || socket.id}. Current submissions map:`, Array.from(room.submissions.entries()).map(([id, pts]) => ({ id, name: room.players.get(id)?.name, points: pts.length, pts })));
    cb?.({ ok: true });
    io.to(socket.id).emit('submitted', { roomId: room.id, points: clean });
    console.log(`[Submit Points] Submission recorded. Total submissions: ${room.submissions.size}/${room.players.size}`);
    // we do not reveal to others until end
    // If all players have submitted, end early
    try {
      if (room.submissions.size >= room.players.size) {
        console.log(`[Submit Points] All players submitted, ending game early`);
        endGame(room.id);
      }
    } catch (e) {
      console.error(`[Submit Points] Error ending game early:`, e);
    }
  });

  socket.on('leave_room', ({ roomId }) => {
    const room = getRoomById(roomId);
    if (!room) return;
    room.players.delete(socket.id);
    room.submissions.delete(socket.id);
    socket.leave(room.id);
    emitLobby(room.id);
  });

  socket.on('disconnect', () => {
    // Remove player from any rooms
    for (const room of rooms.values()) {
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        room.submissions.delete(socket.id);
        room.totals.delete(socket.id);
        room.readyNext.delete(socket.id);
        emitLobby(room.id);
      }
      // If host disconnected and game not started, optionally transfer host; for now keep as-is.
    }
  });
  // Ready up for next round
  socket.on('ready_next', ({ roomId }, cb) => {
    const room = getRoomById(roomId);
    if (!room) return cb?.({ ok: false, error: 'Room not found' });
    // Accept late clicks gracefully: if already running, acknowledge and return
    if (room.status === 'running') return cb?.({ ok: true, info: 'Round already started' });
    if (room.status !== 'revealed') return cb?.({ ok: false, error: 'Not in revealed state' });
    if (!room.players.has(socket.id)) return cb?.({ ok: false, error: 'Not in room' });
    room.readyNext.add(socket.id);
    cb?.({ ok: true, readyCount: room.readyNext.size, totalPlayers: room.players.size });
    io.to(room.id).emit('ready_status', { readyCount: room.readyNext.size, totalPlayers: room.players.size });
    if (room.readyNext.size >= room.players.size) {
      if (room.currentRound >= room.settings.totalRounds) {
        const totalsArray = Array.from(room.players.values()).map((p) => ({ playerId: p.id, name: p.name, color: p.color, totalPayoff: room.totals.get(p.id) || 0 }));
        // Determine match winner
        const sorted = [...totalsArray].sort((a, b) => b.totalPayoff - a.totalPayoff);
        const matchWinner = sorted[0] || null;
        io.to(room.id).emit('match_finished', { totals: totalsArray, totalRounds: room.settings.totalRounds, winner: matchWinner });
        room.status = 'finished';
      } else {
        // start next round - use countdown
        room.readyNext.clear();
        // Clear any existing countdown interval
        if (room.countdownInterval) {
          clearInterval(room.countdownInterval);
          room.countdownInterval = undefined;
        }
        let countdown = 3;
        io.to(room.id).emit('countdown', { countdown });
        room.countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            io.to(room.id).emit('countdown', { countdown });
          } else {
            clearInterval(room.countdownInterval);
            room.countdownInterval = undefined;
            // Start the game after countdown
            room.status = 'running';
            room.currentRound += 1;
            room.startedAt = nowMs();
            room.revealAt = room.startedAt + room.settings.durationSec * 1000;
            room.submissions.clear();
            const delay = room.revealAt - nowMs();
            console.log(`[Room ${room.id}] Game started. Round ${room.currentRound}/${room.settings.totalRounds}. Will end in ${delay}ms`);
            io.to(room.id).emit('game_started', { startedAt: room.startedAt, revealAt: room.revealAt, settings: room.settings, currentRound: room.currentRound, totalRounds: room.settings.totalRounds });
            room.timer = setTimeout(() => endGame(room.id), delay);
          }
        }, 1000);
      }
    }
  });
});

function endGame(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'running') {
    console.log(`[Room ${roomId}] Cannot end game - status is ${room?.status || 'room not found'}`);
    return;
  }
  // Clear the timer
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = undefined;
  }
  
  console.log(`[Room ${roomId}] Ending game. Current submissions BEFORE auto-submit:`, Array.from(room.submissions.entries()).map(([id, pts]) => ({ playerId: id, playerName: room.players.get(id)?.name, points: pts.length, pointsArray: pts })));
  console.log(`[Room ${roomId}] Total players:`, room.players.size);
  console.log(`[Room ${roomId}] Players list:`, Array.from(room.players.entries()).map(([id, p]) => ({ id, name: p.name })));
  
  // Give a small delay to allow any pending submissions to complete
  // Then auto-submit empty arrays ONLY for players who truly haven't submitted
  setTimeout(() => {
    const finalRoom = rooms.get(roomId);
    if (!finalRoom || finalRoom.status !== 'running') {
      console.log(`[Room ${roomId}] Room status changed during delay, aborting`);
      return;
    }
    
    console.log(`[Room ${roomId}] After delay - Current submissions:`, Array.from(finalRoom.submissions.entries()).map(([id, pts]) => ({ playerId: id, playerName: finalRoom.players.get(id)?.name, points: pts.length })));
    
    // Auto-submit empty arrays ONLY for players who haven't submitted
    // DO NOT overwrite existing submissions
    for (const [playerId, player] of finalRoom.players.entries()) {
      if (!finalRoom.submissions.has(playerId)) {
        console.log(`[Room ${roomId}] Auto-submitting empty array for player ${player.name} (${playerId}) - NO EXISTING SUBMISSION`);
        finalRoom.submissions.set(playerId, []);
      } else {
        const existingPoints = finalRoom.submissions.get(playerId);
        console.log(`[Room ${roomId}] Player ${player.name} (${playerId}) already has ${existingPoints.length} points - NOT overwriting`);
      }
    }
    
    // Verify all players have submissions
    if (finalRoom.submissions.size < finalRoom.players.size) {
      console.error(`[Room ${roomId}] WARNING: Not all players have submissions! Submissions: ${finalRoom.submissions.size}, Players: ${finalRoom.players.size}`);
      // Force add missing players
      for (const [playerId, player] of finalRoom.players.entries()) {
        if (!finalRoom.submissions.has(playerId)) {
          console.log(`[Room ${roomId}] Force adding empty submission for ${player.name} (${playerId})`);
          finalRoom.submissions.set(playerId, []);
        }
      }
    }
    
    finalRoom.status = 'revealed';
    const { results, winner } = computeResults(finalRoom);
    for (const r of results) {
      finalRoom.totals.set(r.playerId, (finalRoom.totals.get(r.playerId) || 0) + r.payoff);
    }
    const totalsArray = Array.from(finalRoom.players.values()).map((p) => ({ playerId: p.id, name: p.name, color: p.color, totalPayoff: finalRoom.totals.get(p.id) || 0 }));
    console.log(`[Room ${roomId}] Game ended. Round ${finalRoom.currentRound}/${finalRoom.settings.totalRounds}. Results:`, results);
    console.log(`[Room ${roomId}] Final submissions:`, Array.from(finalRoom.submissions.entries()).map(([id, pts]) => ({ playerId: id, playerName: finalRoom.players.get(id)?.name, points: pts.length, pointsArray: pts })));
    io.to(finalRoom.id).emit('results', { results, winner, settings: finalRoom.settings, currentRound: finalRoom.currentRound, totalRounds: finalRoom.settings.totalRounds, totals: totalsArray });
    // Mark finished after a grace period
    setTimeout(() => {
      const r = rooms.get(roomId);
      if (r) r.status = 'finished';
    }, 60_000);
  }, 200); // Small delay to allow pending submissions
}

function emitLobby(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const players = Array.from(room.players.values()).map((p) => ({ id: p.id, name: p.name, color: p.color }));
  io.to(room.id).emit('lobby', { roomId: room.id, status: room.status, players, settings: room.settings });
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Spam Game server listening on http://localhost:${PORT}`);
  // Initialize room "0" on server startup
  getOrCreateRoom0();
  console.log('Room "0" is always available');
});


