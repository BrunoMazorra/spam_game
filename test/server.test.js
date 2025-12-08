import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';
import { io as Client } from 'socket.io-client';
import { createAppServer } from '../server.js';

let server;
let port;
let clients = [];

function connectClient() {
  return new Promise((resolve, reject) => {
    const socket = new Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      timeout: 5000
    });
    socket.once('connect', () => {
      clients.push(socket);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

function waitFor(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const handler = (data) => {
      cleanup();
      resolve(data);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, handler);
    };
    socket.on(event, handler);
  });
}

beforeEach(async () => {
  const created = createAppServer();
  server = created.server;
  await new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterEach(async () => {
  for (const c of clients) {
    try {
      c.removeAllListeners();
      c.disconnect();
      c.close();
    } catch (e) {
      // ignore cleanup errors
    }
  }
  clients = [];
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function createRoom(host, options = {}) {
  return new Promise((resolve) => {
    host.emit('create_room', options, (resp) => resolve(resp));
  });
}

async function joinRoom(client, roomId, name) {
  return new Promise((resolve) => {
    client.emit('join_room', { roomId, name }, (resp) => resolve(resp));
  });
}

async function startGame(client, roomId) {
  return new Promise((resolve) => {
    client.emit('start_game', { roomId }, (resp) => resolve(resp));
  });
}

async function submitPoints(client, roomId, points) {
  return new Promise((resolve) => {
    client.emit('submit_points', { roomId, points }, (resp) => resolve(resp));
  });
}

async function readyNext(client, roomId) {
  return new Promise((resolve) => {
    client.emit('ready_next', { roomId }, (resp) => resolve(resp));
  });
}

function findPlayer(results, playerId) {
  return results.find((r) => r.playerId === playerId);
}

test('join flow keeps lobby state and dev room creation', async () => {
  const host = await connectClient();
  const lobbyEvent = waitFor(host, 'lobby');
  const joinResp = await joinRoom(host, '', 'Host');
  assert.ok(joinResp.ok);
  const lobby = await lobbyEvent;
  assert.equal(lobby.players.length, 1);

  const p2 = await connectClient();
  const lobbyEvent2 = waitFor(p2, 'lobby');
  const joinResp2 = await joinRoom(p2, lobby.roomId, 'P2');
  assert.ok(joinResp2.ok);
  const lobby2 = await lobbyEvent2;
  assert.equal(lobby2.players.length, 2);
});

test('non-host cannot start game', async () => {
  const host = await connectClient();
  const hostRoom = await createRoom(host, { name: 'Host', durationSec: 1, totalRounds: 1 });
  const p2 = await connectClient();
  await joinRoom(p2, hostRoom.roomId, 'P2');
  const resp = await startGame(p2, hostRoom.roomId);
  assert.equal(resp.ok, false);
  assert.match(resp.error, /Only host/i);
});

test('host start emits countdown then game_started', async () => {
  const host = await connectClient();
  const { roomId } = await createRoom(host, { name: 'Host', durationSec: 1, totalRounds: 1 });
  const countdownP = waitFor(host, 'countdown');
  const gameStartedP = waitFor(host, 'game_started');
  const resp = await startGame(host, roomId);
  assert.equal(resp.ok, true);
  const countdown = await countdownP;
  assert.equal(countdown.countdown, 3);
  const gs = await gameStartedP;
  assert.equal(gs.currentRound, 1);
  assert.equal(gs.totalRounds, 1);
});

test('all submissions end round early and produce results', async () => {
  const host = await connectClient();
  const { roomId } = await createRoom(host, { name: 'Host', durationSec: 5, totalRounds: 1 });
  const p2 = await connectClient();
  await joinRoom(p2, roomId, 'P2');
  await startGame(host, roomId);
  await waitFor(host, 'game_started');
  await submitPoints(host, roomId, [0.1]);
  await submitPoints(p2, roomId, [0.2]);
  const results = await waitFor(host, 'results');
  assert.equal(results.results.length, 2);
  assert.equal(results.currentRound, 1);
});

test('missing submissions are auto-submitted as empty', async () => {
  const host = await connectClient();
  const { roomId } = await createRoom(host, { name: 'Host', durationSec: 1, totalRounds: 1 });
  const p2 = await connectClient();
  await joinRoom(p2, roomId, 'P2');
  await startGame(host, roomId);
  await waitFor(host, 'game_started');
  await submitPoints(host, roomId, [0.3]);
  const resEvent = await waitFor(host, 'results');
  const p2Result = findPlayer(resEvent.results, p2.id);
  assert.ok(p2Result, 'Expected second player in results');
  assert.equal(p2Result.points.length, 0);
});

test('multi-round ready_next triggers next round and match_finished', async () => {
  const host = await connectClient();
  const { roomId } = await createRoom(host, { name: 'Host', durationSec: 1, totalRounds: 2 });
  const p2 = await connectClient();
  await joinRoom(p2, roomId, 'P2');
  await startGame(host, roomId);
  await waitFor(host, 'game_started');
  await submitPoints(host, roomId, [0.1]);
  await submitPoints(p2, roomId, [0.2]);
  await waitFor(host, 'results');

  const nextStartedP = waitFor(host, 'game_started');
  await readyNext(host, roomId);
  await readyNext(p2, roomId);
  await nextStartedP;
  await submitPoints(host, roomId, [0.4]);
  await submitPoints(p2, roomId, [0.5]);
  await waitFor(host, 'results');
  const matchFinished = await waitFor(host, 'match_finished');
  assert.equal(matchFinished.totalRounds, 2);
  assert.ok(matchFinished.winner);
});
