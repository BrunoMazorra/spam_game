import { AUTO_SUBMIT_DELAY_MS, COUNTDOWN_START, RESULTS_GRACE_MS, SUBMISSION_LATE_GRACE_MS } from './constants.js';
import { clearRoomTimers, computeResults, ensureHostPlayer, sanitizePoints, transferHostIfNeeded } from './roomUtils.js';
import { roomStore } from './roomStore.js';

export class GameLifecycle {
  constructor(io) {
    this.io = io;
  }

  emitLobby(roomId) {
    const room = roomStore.get(roomId);
    if (!room) return;
    if (room.status !== 'lobby') return;
    ensureHostPlayer(room);
    const players = Array.from(room.players.values()).map((p) => ({ id: p.id, name: p.name, color: p.color, emoji: p.emoji }));
    this.io.to(room.id).emit('lobby', { roomId: room.id, status: room.status, players, settings: room.settings });
  }

  startRound(roomId) {
    const room = roomStore.rooms.get(roomId);
    if (!room) {
      return;
    }
    ensureHostPlayer(room);
    if (room.status === 'running' || room.status === 'countdown') return;
    if (room.status !== 'lobby' && room.status !== 'revealed') return;

    clearRoomTimers(room);
    room.status = 'countdown';
    room.currentRound = (room.currentRound || 0) + 1;
    room.readyNext.clear();
    room.readyToStart?.clear?.();
    room.pendingPrune?.clear?.();
    let countdown = COUNTDOWN_START;
    this.io.to(room.id).emit('countdown', { countdown });
    room.countdownInterval = setInterval(() => {
      countdown -= 1;
      if (countdown > 0) {
        this.io.to(room.id).emit('countdown', { countdown });
        return;
      }
      clearRoomTimers(room);
      room.status = 'running';
      // eslint-disable-next-line no-console
      console.log('[round_start]', JSON.stringify({ roomId: room.id, players: room.players.size, settings: room.settings }));
      room.startedAt = Date.now();
      room.revealAt = room.startedAt + room.settings.durationSec * 1000;
      room.submissions.clear();
      const delay = Math.max(0, room.revealAt - Date.now());
      this.io.to(room.id).emit('game_started', {
        startedAt: room.startedAt,
        revealAt: room.revealAt,
        settings: room.settings,
        currentRound: room.currentRound,
        totalRounds: room.settings.totalRounds
      });
      room.timer = setTimeout(() => this.endGame(room.id), delay);
    }, 1000);
  }

  endGame(roomId) {
    const room = roomStore.rooms.get(roomId);
    if (!room || room.status !== 'running') {
      return;
    }
    ensureHostPlayer(room);
    clearRoomTimers(room);

    setTimeout(() => {
      const finalRoom = roomStore.rooms.get(roomId);
      if (!finalRoom || finalRoom.status !== 'running') {
        return;
      }
      ensureHostPlayer(finalRoom);

      for (const [playerId] of finalRoom.players.entries()) {
        if (!finalRoom.submissions.has(playerId)) {
          finalRoom.submissions.set(playerId, []);
        }
      }

      if (finalRoom.submissions.size < finalRoom.players.size) {
        for (const [playerId] of finalRoom.players.entries()) {
          if (!finalRoom.submissions.has(playerId)) {
            finalRoom.submissions.set(playerId, []);
          }
        }
      }

      finalRoom.status = 'revealed';
      // eslint-disable-next-line no-console
      console.log('[round_end]', JSON.stringify({ roomId: finalRoom.id, players: finalRoom.players.size, submissions: finalRoom.submissions.size }));
      const { results, winner } = computeResults(finalRoom);
      for (const r of results) {
        finalRoom.totals.set(r.playerId, (finalRoom.totals.get(r.playerId) || 0) + r.payoff);
      }
      const totalsArray = Array.from(finalRoom.players.values()).map((p) => ({
        playerId: p.id,
        name: p.name,
        color: p.color,
        emoji: p.emoji,
        totalPayoff: finalRoom.totals.get(p.id) || 0
      }));
      totalsArray.sort((a, b) => b.totalPayoff - a.totalPayoff);
      // Debug log for result emission to confirm recorded submissions.
      // eslint-disable-next-line no-console
      console.log(
        '[results]',
        JSON.stringify({
          roomId: finalRoom.id,
          currentRound: finalRoom.currentRound,
          totalRounds: finalRoom.settings.totalRounds,
          players: finalRoom.players.size,
          submissions: finalRoom.submissions.size,
          totals: totalsArray.map((t) => ({ playerId: t.playerId, payoff: t.totalPayoff }))
        })
      );
      this.io.to(finalRoom.id).emit('results', {
        results,
        winner,
        settings: finalRoom.settings,
        currentRound: finalRoom.currentRound,
        totalRounds: finalRoom.settings.totalRounds,
        totals: totalsArray
      });

      // Prune any players who disconnected mid-round while preserving their cumulative totals.
      if (finalRoom.pendingPrune?.size) {
        for (const playerId of finalRoom.pendingPrune) {
          roomStore.prunePlayer(finalRoom, playerId, { keepTotals: true });
        }
        finalRoom.pendingPrune.clear();
        transferHostIfNeeded(finalRoom);
      }

      if ((finalRoom.currentRound || 0) >= (finalRoom.settings.totalRounds || 0)) {
        // Defer match_finished so listeners can attach after receiving results
        setTimeout(() => {
          const matchWinner = totalsArray[0] || null;
          this.io.to(finalRoom.id).emit('match_finished', {
            totals: totalsArray,
            totalRounds: finalRoom.settings.totalRounds,
            winner: matchWinner
          });
        }, 0);
      }

      clearRoomTimers(finalRoom);
      finalRoom.finishTimer = setTimeout(() => {
        const r = roomStore.rooms.get(roomId);
        if (!r) return;
        if (r.status === 'revealed' && (r.currentRound || 0) >= (r.settings.totalRounds || 0)) {
          r.status = 'finished';
        }
      }, RESULTS_GRACE_MS);
    }, AUTO_SUBMIT_DELAY_MS);
  }

  recordSubmission(roomId, socketId, points) {
    const room = roomStore.get(roomId);
    const now = Date.now();
    const withinLateGrace =
      room &&
      room.revealAt &&
      now <= room.revealAt + AUTO_SUBMIT_DELAY_MS + SUBMISSION_LATE_GRACE_MS;
    if (!room || (room.status !== 'running' && !withinLateGrace)) {
      // eslint-disable-next-line no-console
      console.log(
        '[submission_reject]',
        JSON.stringify({
          roomId,
          playerId: socketId,
          status: room?.status,
          reason: 'Not accepting submissions',
          now,
          revealAt: room?.revealAt,
          allowLate: withinLateGrace
        })
      );
      return { ok: false, error: 'Not accepting submissions' };
    }
    if (!room.players.has(socketId) && room.hostSocketId === socketId) {
      ensureHostPlayer(room);
    }
    if (!room.players.has(socketId)) return { ok: false, error: 'Not in room' };
    const clean = sanitizePoints(points);
    room.submissions.set(socketId, clean);
    // Debug log to trace missing scores in production without leaking raw points.
    // eslint-disable-next-line no-console
    console.log(
      '[submission]',
      JSON.stringify({
        roomId: room.id,
        playerId: socketId,
        pointsCount: clean.length,
        submissions: room.submissions.size,
        players: room.players.size,
        status: room.status,
        lateAccepted: withinLateGrace && room.status !== 'running'
      })
    );
    if (room.submissions.size >= room.players.size) {
      this.endGame(room.id);
    }
    return { ok: true, points: clean };
  }
}
