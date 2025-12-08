import { AUTO_SUBMIT_DELAY_MS, CLIENT_SUBMIT_JITTER_MS, COUNTDOWN_START, RESULT_DELAY_MS, RESULTS_GRACE_MS } from './constants.js';
import { logEvent } from './logger.js';
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
    this.io.to(room.id).emit('lobby', {
      roomId: room.id,
      status: room.status,
      players,
      settings: room.settings,
      currentRound: room.currentRound,
      totalRounds: room.settings.totalRounds
    });
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
      logEvent('round_start', { roomId: room.id, players: room.players.size, settings: room.settings });
      room.startedAt = Date.now();
      room.revealAt = room.startedAt + room.settings.durationSec * 1000;
      logEvent('opportunity_scheduled', {
        roomId: room.id,
        round: room.currentRound,
        startedAt: room.startedAt,
        revealAt: room.revealAt,
        durationSec: room.settings.durationSec
      });
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
      logEvent('opportunity_arrival', {
        roomId: finalRoom.id,
        round: finalRoom.currentRound,
        expectedRevealAt: finalRoom.revealAt,
        arrivedAt: Date.now(),
        players: finalRoom.players.size
      });

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
      // Wait a bounded delay to allow in-flight, on-time submissions to land.
      setTimeout(() => {
        const lockedRoom = roomStore.rooms.get(roomId);
        if (!lockedRoom || lockedRoom.status !== 'revealed') return;

        logEvent('round_end', { roomId: lockedRoom.id, players: lockedRoom.players.size, submissions: lockedRoom.submissions.size });
        const { results, winner } = computeResults(lockedRoom);
        for (const r of results) {
          lockedRoom.totals.set(r.playerId, (lockedRoom.totals.get(r.playerId) || 0) + r.payoff);
        }
        const totalsArray = Array.from(lockedRoom.players.values()).map((p) => ({
          playerId: p.id,
          name: p.name,
          color: p.color,
          emoji: p.emoji,
          totalPayoff: lockedRoom.totals.get(p.id) || 0
        }));
        totalsArray.sort((a, b) => b.totalPayoff - a.totalPayoff);
        // Debug log for result emission to confirm recorded submissions.
        logEvent('results', {
          roomId: lockedRoom.id,
          currentRound: lockedRoom.currentRound,
          totalRounds: lockedRoom.settings.totalRounds,
          players: lockedRoom.players.size,
          submissions: lockedRoom.submissions.size,
          totals: totalsArray.map((t) => ({ playerId: t.playerId, payoff: t.totalPayoff }))
        });
        this.io.to(lockedRoom.id).emit('results', {
          results,
          winner,
          settings: lockedRoom.settings,
          currentRound: lockedRoom.currentRound,
          totalRounds: lockedRoom.settings.totalRounds,
          totals: totalsArray
        });

        // Prune any players who disconnected mid-round while preserving their cumulative totals.
        if (lockedRoom.pendingPrune?.size) {
          for (const playerId of lockedRoom.pendingPrune) {
            roomStore.prunePlayer(lockedRoom, playerId, { keepTotals: true });
          }
          lockedRoom.pendingPrune.clear();
          transferHostIfNeeded(lockedRoom);
        }

        if ((lockedRoom.currentRound || 0) >= (lockedRoom.settings.totalRounds || 0)) {
          // Defer match_finished so listeners can attach after receiving results
          setTimeout(() => {
            const matchWinner = totalsArray[0] || null;
            this.io.to(lockedRoom.id).emit('match_finished', {
              totals: totalsArray,
              totalRounds: lockedRoom.settings.totalRounds,
              winner: matchWinner
            });
          }, 0);
        }

        clearRoomTimers(lockedRoom);
        lockedRoom.finishTimer = setTimeout(() => {
          const r = roomStore.rooms.get(roomId);
          if (!r) return;
          if (r.status === 'revealed' && (r.currentRound || 0) >= (r.settings.totalRounds || 0)) {
            r.status = 'finished';
          }
        }, RESULTS_GRACE_MS);
      }, RESULT_DELAY_MS);
    }, AUTO_SUBMIT_DELAY_MS);
  }

  recordSubmission(roomId, socketId, points, clientSentAt) {
    const room = roomStore.get(roomId);
    const now = Date.now();
    const withinClientJitter =
      room &&
      room.status === 'revealed' &&
      room.revealAt &&
      room.startedAt &&
      clientSentAt &&
      clientSentAt >= room.startedAt &&
      clientSentAt <= room.revealAt + CLIENT_SUBMIT_JITTER_MS &&
      now <= room.revealAt + CLIENT_SUBMIT_JITTER_MS;

    const accepting = room && room.status === 'running';
    if (!room || (!accepting && !withinClientJitter)) {
      logEvent('submission_reject', {
        roomId,
        playerId: socketId,
        status: room?.status,
        reason: 'Not accepting submissions',
        now,
        revealAt: room?.revealAt,
        clientSentAt,
        withinClientJitter
      });
      return { ok: false, error: 'Not accepting submissions' };
    }
    if (!room.players.has(socketId) && room.hostSocketId === socketId) {
      ensureHostPlayer(room);
    }
    if (!room.players.has(socketId)) return { ok: false, error: 'Not in room' };
    const clean = sanitizePoints(points);
    room.submissions.set(socketId, clean);
    // Debug log to trace missing scores in production without leaking raw points.
    logEvent('submission', {
      roomId: room.id,
      playerId: socketId,
      pointsCount: clean.length,
      submissions: room.submissions.size,
      players: room.players.size,
      status: room.status,
      clientSentAt,
      acceptedVia: accepting ? 'running' : 'client_jitter'
    });
    if (room.submissions.size >= room.players.size) {
      this.endGame(room.id);
    }
    return { ok: true, points: clean };
  }
}
