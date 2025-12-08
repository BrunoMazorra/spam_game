/* global io */

// Resolve the Socket.IO backend. Prefer explicit values; default to same origin (Render).
function resolveSocketUrl() {
  if (typeof window === 'undefined') return undefined;
  if (window.__SOCKET_URL__) return window.__SOCKET_URL__;
  if (window.SOCKET_URL) return window.SOCKET_URL;
  // Same-origin (Render) by default.
  return undefined;
}

const SOCKET_URL = resolveSocketUrl();
if (SOCKET_URL) {
  console.log('Using socket host:', SOCKET_URL);
}
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling']
});

function buildApiUrl(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (SOCKET_URL) {
    try {
      return new URL(normalizedPath, SOCKET_URL).toString();
    } catch (err) {
      console.warn('Failed to build API URL', err);
    }
  }
  return normalizedPath;
}

// Elements
const $host = document.getElementById('host');
const $join = document.getElementById('join');
const $lobby = document.getElementById('lobby');
const $play = document.getElementById('play');
const $results = document.getElementById('results');

const $navHost = document.getElementById('navHost');
const $navJoin = document.getElementById('navJoin');

const $nameInput = document.getElementById('nameInput');
const $nameInputJoin = document.getElementById('nameInputJoin');
const $costInput = document.getElementById('costInput');
const $durInput = document.getElementById('durInput');
const $roomInput = document.getElementById('roomInput');
const $myNameLobbyInput = document.getElementById('myNameLobbyInput');
const $createBtn = document.getElementById('createBtn');
const $joinBtn = document.getElementById('joinBtn');
const $shareRow = document.getElementById('shareRow');
const $shareLink = document.getElementById('shareLink');
const $copyShareBtn = document.getElementById('copyShareBtn');
const $startBtn = document.getElementById('startBtn');
const $roomIdLabel = document.getElementById('roomIdLabel');
const $players = document.getElementById('players');
const $costLabel = document.getElementById('costLabel');
const $durationLabel = document.getElementById('durationLabel');
const $costLabel2 = document.getElementById('costLabel2');
const $readyLabel = document.getElementById('readyLabel');
const $myEmojiBadge = document.getElementById('myEmojiBadge');
const $setNameBtn = document.getElementById('setNameBtn');
const $errorBar = document.getElementById('errorBar');

const $board = document.getElementById('board');
const $countdownLabel = document.getElementById('countdownLabel');
const $myPoints = document.getElementById('myPoints');
const $countdownDisplay = document.createElement('div');
$countdownDisplay.id = 'countdownDisplay';
$countdownDisplay.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: clamp(60px, 20vw, 120px); font-weight: 700; color: #ff4b4b; text-shadow: 0 0 24px rgba(255, 75, 75, 0.6); z-index: 1000; pointer-events: none; display: none; font-family: Inter, system-ui, sans-serif;';
document.body.appendChild($countdownDisplay);

const $reveal = document.getElementById('reveal');
const $resultsBody = document.getElementById('resultsBody');
const $winnerLabel = document.getElementById('winnerLabel');
const $backToLobbyBtn = document.getElementById('backToLobbyBtn');
const $roundLabel = document.getElementById('roundLabel');
const $nextRoundBtn = document.getElementById('nextRoundBtn');
const $readyStatus = document.getElementById('readyStatus');
const $resultsLegend = document.getElementById('resultsLegend');
const $publicRoomsList = document.getElementById('publicRoomsList');
const $publicRoomsEmpty = document.getElementById('publicRoomsEmpty');
const $refreshRoomsBtn = document.getElementById('refreshRoomsBtn');

// State
let myName = '';
let roomId = '';
let settings = { costPerPoint: 0.05, durationSec: 10 };
let gameTimes = { startedAt: 0, revealAt: 0 };
let countdownTimer = null;
let myPoints = [];
let myId = null;
let myColor = '#ff4b4b';
let myEmoji = '';
let roundInfo = { current: 0, total: 0 };
let isHost = false;
let inviteUrl = '';
let lastReadyCounts = { ready: 0, total: 0 };
let lastKnownRoomId = '';
let publicRoomsTimer = null;
let winnerEmojiTimer = null;
let publicRoomsLoading = false;
let clickAudioCtx = null;
let clickAudioBus = null;
let lastWinJingleAt = 0;
// Short slot-machine style chirp for point drops
function ensureClickAudio() {
  try {
    if (!clickAudioCtx) {
      clickAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      clickAudioBus = clickAudioCtx.createGain();
      clickAudioBus.gain.value = 1.0; // louder bed for SFX
      clickAudioBus.connect(clickAudioCtx.destination);
    } else if (clickAudioCtx.state === 'suspended') {
      clickAudioCtx.resume();
    }
    return clickAudioCtx;
  } catch (err) {
    console.warn('Audio init failed', err);
    return null;
  }
}

function playSlotClickSound() {
  const ctx = ensureClickAudio();
  if (!ctx || !clickAudioBus) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  // Metallic "ker-ching" sweep like a slot payout bell.
  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(420, now);
  body.frequency.exponentialRampToValueAtTime(1250, now + 0.08);
  body.frequency.exponentialRampToValueAtTime(780, now + 0.22); // rise then settle
  bodyGain.gain.setValueAtTime(0.5, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.18, now + 0.16);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

  // High chime for the coin sparkle.
  const chime = ctx.createOscillator();
  const chimeGain = ctx.createGain();
  chime.type = 'square';
  chime.frequency.setValueAtTime(1600, now + 0.02);
  chime.frequency.exponentialRampToValueAtTime(2200, now + 0.14);
  chimeGain.gain.setValueAtTime(0.42, now + 0.02);
  chimeGain.gain.exponentialRampToValueAtTime(0.14, now + 0.16);
  chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

  // Low thunk to feel the coin drop.
  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(180, now);
  thump.frequency.exponentialRampToValueAtTime(120, now + 0.08);
  thumpGain.gain.setValueAtTime(0.32, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.05, now + 0.12);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * (1 - t);
  }
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.18, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
  noise.buffer = buffer;
  noise.connect(noiseGain);
  noiseGain.connect(clickAudioBus);

  body.connect(bodyGain);
  bodyGain.connect(clickAudioBus);
  chime.connect(chimeGain);
  chimeGain.connect(clickAudioBus);
  thump.connect(thumpGain);
  thumpGain.connect(clickAudioBus);

  body.start(now);
  body.stop(now + 0.5);
  chime.start(now + 0.02);
  chime.stop(now + 0.36);
  thump.start(now);
  thump.stop(now + 0.32);
  noise.start(now);
  noise.stop(now + 0.24);
}

function playWinnerJingle() {
  const ctx = ensureClickAudio();
  if (!ctx || !clickAudioBus) return;
  const now = ctx.currentTime;
  // throttle to avoid double-play on rapid events
  if (now - lastWinJingleAt < 2.5) return;
  lastWinJingleAt = now;

  const melody = [
    { t: 0.0, freq: 587 },   // D5
    { t: 0.12, freq: 784 },  // G5
    { t: 0.24, freq: 880 },  // A5
    { t: 0.36, freq: 1175 }, // D6
    { t: 0.60, freq: 1047 }, // C6
    { t: 0.76, freq: 784 },  // G5
    { t: 0.92, freq: 1319 }, // E6
    { t: 1.10, freq: 1175 }, // D6
    { t: 1.26, freq: 1568 }, // G6
    { t: 1.42, freq: 1760 }  // A6
  ];

  const pad = ctx.createGain();
  pad.gain.setValueAtTime(0.4, now);
  pad.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
  pad.connect(clickAudioBus);

  // Warm pad under the melody
  const padOsc = ctx.createOscillator();
  padOsc.type = 'triangle';
  padOsc.frequency.setValueAtTime(196, now); // G3
  padOsc.connect(pad);
  padOsc.start(now);
  padOsc.stop(now + 2.2);

  for (const note of melody) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(note.freq, now + note.t);
    gain.gain.setValueAtTime(0.38, now + note.t);
    gain.gain.exponentialRampToValueAtTime(0.001, now + note.t + 0.26);
    osc.connect(gain);
    gain.connect(clickAudioBus);
    osc.start(now + note.t);
    osc.stop(now + note.t + 0.3);
  }

  // Simple noise burst for sparkle
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * (1 - t);
  }
  noise.buffer = buffer;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.12, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  noise.connect(noiseGain);
  noiseGain.connect(clickAudioBus);
  noise.start(now);
  noise.stop(now + 0.5);
}

// Final celebration overlay elements (injected at runtime)
const finalCelebrationStyles = document.createElement('style');
finalCelebrationStyles.id = 'finalCelebrationStyles';
finalCelebrationStyles.textContent = `
#finalCelebrationOverlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 30% 20%, rgba(255, 107, 107, 0.25), transparent 38%),
              radial-gradient(circle at 70% 10%, rgba(158, 252, 255, 0.22), transparent 34%),
              rgba(5, 6, 8, 0.76);
  backdrop-filter: blur(10px);
  z-index: 2000;
}
#finalCelebrationCard {
  width: min(640px, 92vw);
  background: linear-gradient(135deg, rgba(15, 20, 28, 0.95), rgba(12, 14, 18, 0.92));
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  padding: 26px;
  box-shadow: 0 28px 64px rgba(0, 0, 0, 0.4), 0 0 24px rgba(255, 107, 107, 0.3);
  color: #eef0f3;
  position: relative;
  overflow: hidden;
}
#finalCelebrationCard::after {
  content: '';
  position: absolute;
  inset: -30% -10% auto;
  height: 180px;
  background: radial-gradient(circle, rgba(158, 252, 255, 0.18), transparent 50%);
  opacity: 0.9;
  pointer-events: none;
  filter: blur(6px);
}
#finalChampion {
  font-size: 26px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 8px 0;
  letter-spacing: -0.2px;
}
#finalChampion small {
  font-size: 14px;
  color: #9fb3c8;
  font-weight: 600;
}
#finalScoreboard {
  margin: 16px 0 10px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
#finalScoreboardRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.final-row {
  display: grid;
  grid-template-columns: 32px 1fr 120px;
  align-items: center;
  padding: 10px 12px;
  gap: 10px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.final-row:nth-child(even) { background: rgba(255, 255, 255, 0.03); }
.final-row.winner {
  background: linear-gradient(120deg, rgba(255, 107, 107, 0.14), rgba(158, 252, 255, 0.1));
  border-bottom-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 10px 30px rgba(255, 107, 107, 0.24);
}
.final-rank {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #fff;
}
.final-payoff {
  text-align: right;
  font-weight: 700;
  color: #fefefe;
}
#finalCloseBtn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  padding: 6px 10px;
  color: #fff;
  font-weight: 700;
}
#finalConfetti {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(circle at 20% 20%, rgba(255,107,107,0.35) 0, transparent 18%),
    radial-gradient(circle at 80% 10%, rgba(158,252,255,0.4) 0, transparent 16%),
    radial-gradient(circle at 60% 70%, rgba(216,195,255,0.28) 0, transparent 18%);
  opacity: 0;
  animation: confettiPulse 2.6s ease forwards;
}
@keyframes confettiPulse {
  0% { opacity: 0; transform: scale(0.96); }
  30% { opacity: 1; transform: scale(1); }
  100% { opacity: 1; transform: scale(1.02); }
}
`;
document.head.appendChild(finalCelebrationStyles);

const $finalCelebration = document.createElement('div');
$finalCelebration.id = 'finalCelebrationOverlay';
$finalCelebration.innerHTML = `
  <div id="finalCelebrationCard">
    <div id="finalConfetti"></div>
    <button id="finalCloseBtn" aria-label="Close final results">×</button>
    <div id="finalChampion">Champion</div>
    <div class="muted" id="finalRoundsSummary"></div>
    <div id="finalScoreboard"></div>
  </div>
`;
document.body.appendChild($finalCelebration);
const $finalChampion = $finalCelebration.querySelector('#finalChampion');
const $finalScoreboard = $finalCelebration.querySelector('#finalScoreboard');
const $finalRoundsSummary = $finalCelebration.querySelector('#finalRoundsSummary');
const $finalCloseBtn = $finalCelebration.querySelector('#finalCloseBtn');
$finalCloseBtn.addEventListener('click', () => {
  $finalCelebration.style.display = 'none';
});

function renderFinalCelebration({ totals, totalRounds, winner }) {
  if (!$finalCelebration || !$finalChampion || !$finalScoreboard) return;
  const champion = winner || (Array.isArray(totals) && totals[0]);
  if (!champion) return;
  const sorted = Array.isArray(totals) ? [...totals].sort((a, b) => b.totalPayoff - a.totalPayoff) : [];
  $finalChampion.textContent = `${displayName(champion.name, champion.emoji)} is the champion!`;
  const roundsText = totalRounds ? `${totalRounds} rounds` : (sorted.length ? 'all rounds' : 'the match');
  $finalRoundsSummary.textContent = `After ${roundsText}`;
  $finalScoreboard.innerHTML = '';
  if (sorted.length) {
    sorted.forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = 'final-row';
      if (champion && champion.playerId === t.playerId) row.classList.add('winner');
      const rank = document.createElement('div');
      rank.className = 'final-rank';
      rank.textContent = `#${idx + 1}`;
      const name = document.createElement('div');
      name.textContent = displayName(t.name, t.emoji);
      name.style.color = t.color;
      const payoff = document.createElement('div');
      payoff.className = 'final-payoff';
      payoff.textContent = t.totalPayoff.toFixed(4);
      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(payoff);
      $finalScoreboard.appendChild(row);
    });
  }
  $finalCelebration.style.display = 'flex';
}

function setError(message) {
  if (!$errorBar) return;
  if (!message) {
    $errorBar.style.display = 'none';
    $errorBar.textContent = '';
    return;
  }
  $errorBar.textContent = message;
  $errorBar.style.display = 'block';
}

socket.on('connect', () => {
  myId = socket.id;
  if (roomId) {
    lastKnownRoomId = roomId;
  }
  if (lastKnownRoomId) {
    joinRoomById(lastKnownRoomId, { silent: true });
  }
  setError('');
});

socket.io.on('reconnect_attempt', () => {
  setError('Reconnecting...');
});

socket.on('disconnect', (reason) => {
  setError(reason ? `Disconnected: ${reason}` : 'Disconnected. Reconnecting...');
});

socket.on('connect_error', (err) => {
  setError(err?.message || 'Connection error. Retrying...');
});

function show(section) {
  $host.style.display = section === 'host' ? 'block' : 'none';
  $join.style.display = section === 'join' ? 'block' : 'none';
  $lobby.style.display = section === 'lobby' ? 'block' : 'none';
  $play.style.display = section === 'play' ? 'block' : 'none';
  $results.style.display = section === 'results' ? 'block' : 'none';

  if ($navHost && $navJoin) {
    $navHost.classList.remove('primary', 'is-active');
    $navJoin.classList.remove('primary', 'is-active');
    $navHost.classList.add('ghost');
    $navJoin.classList.add('ghost');

    if (section === 'host') {
      $navHost.classList.add('primary', 'is-active');
      $navHost.classList.remove('ghost');
    } else if (section === 'join') {
      $navJoin.classList.add('primary', 'is-active');
      $navJoin.classList.remove('ghost');
    }
  }
}

function formatPoints(points) {
  return points.map((x) => x.toFixed(3)).join(', ');
}

function displayName(name, emoji) {
  return emoji ? `${emoji} ${name}` : name;
}

function clearWinnerEmoji() {
  if (winnerEmojiTimer) {
    clearTimeout(winnerEmojiTimer);
    winnerEmojiTimer = null;
  }
  const existing = $winnerLabel?.querySelector('.party-emoji');
  if (existing) existing.remove();
}

function showPartyEmoji(target) {
  if (!target) return;
  clearWinnerEmoji();
  const emoji = document.createElement('span');
  emoji.className = 'party-emoji';
  emoji.textContent = '🎉';
  target.appendChild(emoji);
  const remove = () => {
    emoji.remove();
    if (winnerEmojiTimer) {
      clearTimeout(winnerEmojiTimer);
      winnerEmojiTimer = null;
    }
  };
  emoji.addEventListener('animationend', remove, { once: true });
  winnerEmojiTimer = setTimeout(remove, 2000);
}

function renderWinnerLabel(winner) {
  if (!$winnerLabel) return;
  if (!winner) {
    $winnerLabel.textContent = 'No winner (no submissions)';
    clearWinnerEmoji();
    return;
  }
  const text = `Winner: ${displayName(winner.name, winner.emoji)} • payoff ${winner.payoff.toFixed(4)}`;
  $winnerLabel.textContent = text;
  showPartyEmoji($winnerLabel);
}

function updateMyIdentityUI(player) {
  if (player) {
    myName = player.name;
    myEmoji = player.emoji || myEmoji || '🐾';
    if ($myNameLobbyInput && document.activeElement !== $myNameLobbyInput) {
      $myNameLobbyInput.value = player.name;
    }
    if ($myEmojiBadge) {
      $myEmojiBadge.textContent = myEmoji || '🐾';
    }
  } else {
    if ($myEmojiBadge) $myEmojiBadge.textContent = myEmoji || '🐾';
  }
}

function getRoomFromLocation() {
  const url = new URL(window.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1]) return parts[1].toUpperCase();
  const qp = url.searchParams.get('room');
  return qp ? qp.trim().toUpperCase() : '';
}

function extractRoomId(raw) {
  if (!raw) return '';
  const trimmed = raw.toString().trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'room' && parts[1]) return parts[1].toUpperCase();
    const qp = url.searchParams.get('room');
    if (qp) return qp.trim().toUpperCase();
  } catch (_) {
    // not a URL, fall through
  }
  return trimmed.toUpperCase();
}

function buildInviteUrl(id) {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.searchParams.set('room', id);
  url.hash = '';
  return url.toString();
}

function updateInviteLink(id) {
  if (!id) return;
  inviteUrl = buildInviteUrl(id);
  if ($shareLink) {
    $shareLink.textContent = inviteUrl;
  }
  if ($shareRow && isHost) {
    $shareRow.style.display = 'flex';
  }
}

function applyRoomToUrl(id) {
  if (!id) return;
  const newUrl = buildInviteUrl(id);
  window.history.replaceState({}, '', newUrl);
}

function setRoomContext(rid, s) {
  if (rid) {
    roomId = rid;
    lastKnownRoomId = rid;
    lastReadyCounts = { ready: 0, total: 0 };
    updateInviteLink(roomId);
    applyRoomToUrl(roomId);
    if ($roomInput) $roomInput.value = roomId;
  }
  if (s) settings = s;
  $roomIdLabel.textContent = roomId;
  $costLabel.textContent = settings.costPerPoint;
  $durationLabel.textContent = settings.durationSec;
  if ($roundLabel && roundInfo.total) {
    $roundLabel.textContent = `${roundInfo.current}/${roundInfo.total}`;
  }
  if ($shareRow) {
    $shareRow.style.display = isHost ? 'flex' : 'none';
  }
}

async function refreshPublicRooms() {
  if (!$publicRoomsList) return;
  try {
    publicRoomsLoading = true;
    renderPublicRooms([]);
    const res = await fetch(buildApiUrl('/api/public-rooms'));
    const data = await res.json();
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    renderPublicRooms(rooms);
  } catch (err) {
    console.error('Failed to load public rooms', err);
    renderPublicRooms([]);
  } finally {
    publicRoomsLoading = false;
  }
}

function renderPublicRooms(rooms) {
  if (!$publicRoomsList) return;
  $publicRoomsList.innerHTML = '';
  if (publicRoomsLoading) {
    const row = document.createElement('div');
    row.className = 'muted';
    row.textContent = 'Loading rooms...';
    $publicRoomsList.appendChild(row);
    return;
  }
  if (!rooms.length) {
    if ($publicRoomsEmpty) {
      $publicRoomsEmpty.style.display = 'block';
      $publicRoomsEmpty.textContent = 'No public rooms available yet.';
      $publicRoomsList.appendChild($publicRoomsEmpty);
    }
    return;
  }
  if ($publicRoomsEmpty) $publicRoomsEmpty.style.display = 'none';
  for (const room of rooms) {
    const btn = document.createElement('button');
    btn.className = 'ghost public-room';
    const left = document.createElement('div');
    left.textContent = `Room ${room.id}`;
    const right = document.createElement('div');
    right.className = 'muted';
    right.textContent = `${room.players} in lobby`;
    btn.appendChild(left);
    btn.appendChild(right);
    btn.addEventListener('click', () => {
      if ($roomInput) $roomInput.value = room.id;
      joinRoomById(room.id);
    });
    $publicRoomsList.appendChild(btn);
  }
}

function startPublicRoomsPolling() {
  refreshPublicRooms();
  if (publicRoomsTimer) clearInterval(publicRoomsTimer);
  publicRoomsTimer = setInterval(() => refreshPublicRooms(), 10000);
}

function stopPublicRoomsPolling() {
  if (publicRoomsTimer) {
    clearInterval(publicRoomsTimer);
    publicRoomsTimer = null;
  }
}

// Canvas helpers
function clearCanvas(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawAxis(ctx, width, height) {
  ctx.strokeStyle = 'rgba(255, 212, 71, 0.32)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, height - 30);
  ctx.lineTo(width - 20, height - 30);
  ctx.stroke();
  // ticks 0, 0.5, 1
  const ticks = [0, 0.5, 1];
  ctx.fillStyle = '#9fb3c8';
  const fontSize = Math.max(10, Math.min(12, width / 80));
  ctx.font = `${fontSize}px Inter, sans-serif`;
  for (const t of ticks) {
    const x = 20 + t * (width - 40);
    ctx.beginPath();
    ctx.moveTo(x, height - 30);
    ctx.lineTo(x, height - 36);
    ctx.strokeStyle = 'rgba(255, 212, 71, 0.25)';
    ctx.stroke();
    ctx.fillText(String(t), x - 6, height - 12);
  }
}

function drawMyPoints(ctx, points, color = myColor, width, height) {
  const pointSize = Math.max(4, Math.min(6, width / 150));
  for (const x of points) {
    const px = 20 + x * (width - 40);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, height / 2, pointSize, 0, Math.PI * 2);
    ctx.fill();
  }
}

function getCurrentLinePosition() {
  // Returns the current position of the red line (0 to 1) based on elapsed time
  if (gameTimes.startedAt > 0 && gameTimes.revealAt > 0) {
    const now = Date.now();
    const elapsed = now - gameTimes.startedAt;
    const total = gameTimes.revealAt - gameTimes.startedAt;
    if (elapsed >= 0 && elapsed <= total) {
      return Math.min(1, Math.max(0, elapsed / total));
    }
  }
  return null; // Game not started or finished
}

function renderBoard() {
  const ctx = $board.getContext('2d');
  // Scale canvas for high DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = $board.getBoundingClientRect();
  $board.width = rect.width * dpr;
  $board.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  
  clearCanvas(ctx);
  drawAxis(ctx, width, height);
  drawMyPoints(ctx, myPoints, myColor, width, height);
  // Draw moving vertical line based on elapsed time - always show, starting at 0
  const progress = getCurrentLinePosition();
  if (progress !== null) {
    // Ensure line starts at x=20 (position 0) when progress is 0
    const x = 20 + Math.max(0, Math.min(1, progress)) * (width - 40);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x, height - 40);
    ctx.stroke();
  } else if (gameTimes.startedAt > 0) {
    // If game has started but progress is null, show line at start (0)
    const x = 20;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x, height - 40);
    ctx.stroke();
  }
}

function updateMyPointsUI() {
  $myPoints.innerHTML = '';
  for (const x of myPoints) {
    const span = document.createElement('span');
    span.className = 'pill';
    span.textContent = x.toFixed(3);
    $myPoints.appendChild(span);
  }
}

let hasSubmitted = false;
let clickCostTotal = 0;

function submitPoints() {
  // Submit points function - used by both auto-submit and manual submit
  if (!roomId) {
    console.error('Cannot submit: no room ID');
    return;
  }
  if (hasSubmitted) {
    console.log('Already submitted, skipping');
    return;
  }
  hasSubmitted = true;
  const clientSentAt = Date.now();
  console.log('Submitting points:', myPoints, 'to room:', roomId, 'at', clientSentAt);
  // Ensure roomId is sent as string, especially for room "0"
  const submitRoomId = roomId.toString().trim();
  console.log('Sending submit_points with roomId:', submitRoomId);
  socket.emit('submit_points', { roomId: submitRoomId, points: myPoints, clientSentAt }, (res) => {
    if (!res?.ok) {
      console.error('Submit failed:', res?.error);
      setError(res?.error || 'Submit failed');
      hasSubmitted = false; // Allow retry if submission failed
    } else {
      console.log('Points submitted successfully to room:', submitRoomId);
      setError('');
    }
  });
}

function setCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  hasSubmitted = false; // Reset submission flag when starting new round
  let submittedThisRound = false; // Track if we've submitted this round
  countdownTimer = setInterval(() => {
    const now = Date.now();
    const leftMs = Math.max(0, gameTimes.revealAt - now);
    const elapsed = gameTimes.revealAt - gameTimes.startedAt;
    const progress = elapsed > 0 ? Math.min(100, Math.max(0, ((elapsed - leftMs) / elapsed) * 100)) : 0;
    $countdownLabel.textContent = `${progress.toFixed(1)}%`;
    // Redraw board to update the moving line
    renderBoard();
    
    // Auto-submit when progress reaches 100% (line reaches the end) or time runs out
    // Use >= 99.5 to catch it before it might miss, or leftMs <= 0
    if ((progress >= 99.5 || leftMs <= 0) && !submittedThisRound && roomId) {
      clearInterval(countdownTimer);
      submittedThisRound = true;
      // Make a copy of points to ensure we submit what we have
      const pointsToSubmit = [...myPoints];
      const clientSentAt = Date.now();
      console.log('Auto-submitting points:', pointsToSubmit, 'Progress:', progress, 'LeftMs:', leftMs, 'RoomId:', roomId, 'at', clientSentAt);
      
      // Submit directly without going through submitPoints to avoid hasSubmitted check
      if (!roomId) {
        console.error('Cannot submit: no room ID');
        return;
      }
      hasSubmitted = true;
      const submitRoomId = roomId.toString().trim();
      console.log('Sending submit_points with roomId:', submitRoomId, 'points:', pointsToSubmit, 'at', clientSentAt);
      socket.emit('submit_points', { roomId: submitRoomId, points: pointsToSubmit, clientSentAt }, (res) => {
        if (!res?.ok) {
          console.error('Submit failed:', res?.error);
          setError(res?.error || 'Submit failed');
          hasSubmitted = false; // Allow retry if submission failed
          submittedThisRound = false;
        } else {
          console.log('Points submitted successfully to room:', submitRoomId, 'points:', pointsToSubmit);
          setError('');
        }
      });
    }
  }, 50); // Update more frequently for smoother line movement
}

function joinRoomById(rid, { silent = false } = {}) {
  const targetId = extractRoomId(rid) || '0'; // default to dev room when empty
  isHost = false;
  socket.emit('join_room', { roomId: targetId, name: myName }, (res) => {
    if (!res?.ok) {
      if (!silent) {
        setError(res?.error || 'Failed to join');
      } else {
        setError(res?.error || 'Room not found or expired. Please create or join again.');
      }
      return;
    }
    setError('');
    const joinedId = res.roomId || targetId;
    setRoomContext(joinedId, res.settings);
    show('lobby');
    stopPublicRoomsPolling();
  });
}

// Interactions
$navHost?.addEventListener('click', () => {
  stopPublicRoomsPolling();
  show('host');
});
$navJoin?.addEventListener('click', () => {
  show('join');
  startPublicRoomsPolling();
});

$createBtn?.addEventListener('click', () => {
  myName = ($nameInput.value || '').trim() || 'Host';
  const costPerPoint = parseFloat($costInput.value || '0.05');
  const durationSec = parseInt($durInput.value || '10', 10);
  socket.emit('create_room', { name: myName, costPerPoint, durationSec }, (res) => {
    if (!res?.ok) { setError(res?.error || 'Failed to create room'); return; }
    setError('');
    isHost = true;
    setRoomContext(res.roomId, res.settings);
    if ($shareRow) $shareRow.style.display = 'flex';
    show('lobby');
  });
});

$joinBtn?.addEventListener('click', () => {
  myName = ($nameInputJoin?.value || $nameInput?.value || '').trim() || 'Player';
  const rid = extractRoomId($roomInput.value) || '0';
  isHost = false;
  if (!$roomInput.value) $roomInput.value = rid;
  joinRoomById(rid);
});

$setNameBtn?.addEventListener('click', () => {
  if (!roomId) return;
  const desiredName = ($myNameLobbyInput?.value || '').trim() || 'Player';
  socket.emit('set_name', { roomId, name: desiredName }, (res) => {
    if (!res?.ok) {
      setError(res?.error || 'Failed to update name');
      return;
    }
    setError('');
    myName = res.name;
    myEmoji = res.emoji || myEmoji;
    if ($myNameLobbyInput) $myNameLobbyInput.value = res.name;
    if ($myEmojiBadge) $myEmojiBadge.textContent = myEmoji || '🐾';
  });
});

$myNameLobbyInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $setNameBtn?.click();
  }
});

$copyShareBtn?.addEventListener('click', async () => {
  if (!roomId) {
    alert('Create or join a room first');
    return;
  }
  const target = inviteUrl || buildInviteUrl(roomId);
  try {
    await navigator.clipboard.writeText(target);
    const original = $copyShareBtn.textContent;
    $copyShareBtn.textContent = 'Copied!';
    setTimeout(() => { $copyShareBtn.textContent = original || 'Copy link'; }, 1200);
  } catch (err) {
    console.error('Clipboard copy failed, falling back to prompt', err);
    window.prompt('Copy invite link', target);
  }
});

$startBtn.addEventListener('click', () => {
  if (!roomId) return;
  $startBtn.disabled = true;
  if (isHost) {
    $startBtn.textContent = 'Starting...';
    socket.emit('start_game', { roomId }, (res) => {
      if (res && !res.ok) {
        setError(res.error || 'Cannot start');
        $startBtn.disabled = false;
        $startBtn.textContent = 'Ready / Start';
      } else {
        setError('');
      }
    });
  } else {
    $startBtn.textContent = 'Ready ✓';
    socket.emit('ready_to_start', { roomId }, (res) => {
      if (res && !res.ok) {
        setError(res.error || 'Cannot ready up');
        $startBtn.disabled = false;
        $startBtn.textContent = 'Ready / Start';
      } else {
        setError('');
      }
    });
  }
});

// Submit button removed - auto-submit when line reaches end

$backToLobbyBtn.addEventListener('click', () => {
  show('lobby');
});

$refreshRoomsBtn?.addEventListener('click', () => refreshPublicRooms());

$nextRoundBtn.addEventListener('click', () => {
  if (!roomId) return;
  $nextRoundBtn.disabled = true;
  $nextRoundBtn.textContent = 'Ready ✓';
  $readyStatus.textContent = 'Waiting for others...';
  socket.emit('ready_next', { roomId }, (res) => {
    if (!res?.ok) {
      setError(res?.error || 'Failed to ready up');
      $nextRoundBtn.disabled = false;
      $nextRoundBtn.textContent = 'Next Round';
      $readyStatus.textContent = '';
    } else {
      setError('');
    }
  });
});

socket.on('ready_status', ({ readyCount, totalPlayers }) => {
  $readyStatus.textContent = `Ready ${readyCount}/${totalPlayers}`;
});

socket.on('match_finished', ({ totals, totalRounds, winner }) => {
  const summary = Array.isArray(totals) && totals.length
    ? ' | ' + totals.map(t => `${displayName(t.name, t.emoji)}: ${t.totalPayoff.toFixed(4)}`).join(' | ')
    : '';
  const winnerText = winner ? ` Winner: ${displayName(winner.name, winner.emoji)} (${winner.totalPayoff.toFixed(4)}).` : '';
  $readyStatus.textContent = `Match finished (${totalRounds} rounds).${winnerText}${summary}`;
  $nextRoundBtn.style.display = 'none';
  if ($winnerLabel && winner) {
    $winnerLabel.textContent = `Champion: ${displayName(winner.name, winner.emoji)} • total payoff ${winner.totalPayoff.toFixed(4)}`;
    showPartyEmoji($winnerLabel);
  }
  if (winner) {
    playWinnerJingle();
  }
  renderFinalCelebration({ totals, totalRounds, winner });
});

$board.addEventListener('click', (e) => {
  const linePosition = getCurrentLinePosition();
  if (linePosition !== null) {
    // Only treat a click as a delete when it's essentially on top of an existing point.
    // A tighter epsilon prevents rapid clicks (as the line moves) from undoing the most recent point.
    const removalEps = 0.005; // ~0.5% of the segment width
    const existingIdx = myPoints.findIndex((p) => Math.abs(p - linePosition) < removalEps);
    if (existingIdx >= 0) {
      myPoints.splice(existingIdx, 1);
    } else {
      myPoints.push(linePosition);
      myPoints.sort((a, b) => a - b);
      flashCost(e.clientX, e.clientY);
      playSlotClickSound();
    }
    updateMyPointsUI();
    renderBoard();
  }
});

function flashCost(clientX, clientY) {
  const flash = document.createElement('div');
  flash.className = 'cost-flash';
  const cost = Number(settings.costPerPoint ?? 0.05) || 0;
  clickCostTotal += cost;
  const displayCost = clickCostTotal.toFixed(2);
  flash.textContent = `-$${displayCost}`;
  flash.style.left = `${clientX}px`;
  flash.style.top = `${clientY}px`;
  flash.style.transform = 'translate(-50%, -50%) translateY(0px)';
  flash.style.opacity = '0';
  document.body.appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.opacity = '1';
    flash.style.transform = 'translate(-50%, -50%) translateY(-10px)';
  });
  setTimeout(() => {
    flash.style.opacity = '0';
    flash.style.transform = 'translate(-50%, -50%) translateY(-18px)';
    setTimeout(() => flash.remove(), 200);
  }, 420);
}

// Socket listeners
socket.on('lobby', ({ roomId: rid, players, settings: s, status }) => {
  setError('');
  setRoomContext(rid, s);
  $players.innerHTML = '';
  for (const p of players) {
    const span = document.createElement('span');
    span.className = 'pill';
    span.style.borderColor = p.color;
    span.textContent = displayName(p.name, p.emoji);
    $players.appendChild(span);
  }
  const me = players.find((p) => p.id === myId);
  if (me) {
    updateMyIdentityUI(me);
    myColor = me.color;
    renderBoard();
  } else {
    updateMyIdentityUI(null);
  }
  // Reset start button
  $startBtn.disabled = false;
  $startBtn.textContent = 'Ready / Start';
  if ($readyLabel && lastReadyCounts.total > 0) {
    $readyLabel.textContent = `Ready ${lastReadyCounts.ready}/${lastReadyCounts.total}`;
  } else if ($readyLabel) {
    $readyLabel.textContent = '';
  }
  // Show host-only sharing row
  if (isHost && $shareRow) {
    $shareRow.style.display = 'flex';
  } else if ($shareRow) {
    $shareRow.style.display = 'none';
  }
  // Only switch the view when the server says the room is in lobby.
  // If a disconnect happens mid-round we still want to stay on play/results.
  if (status === 'lobby') {
    show('lobby');
  }
});

socket.on('ready_to_start_status', ({ readyCount, totalPlayers }) => {
  lastReadyCounts = { ready: readyCount, total: totalPlayers };
  if (readyCount < totalPlayers) {
    $startBtn.textContent = `Ready ${readyCount}/${totalPlayers}`;
    $startBtn.disabled = false;
  } else {
    $startBtn.textContent = 'Starting...';
    $startBtn.disabled = true;
  }
  if ($readyLabel) {
    $readyLabel.textContent = `Ready ${readyCount}/${totalPlayers}`;
  }
});

socket.on('countdown', ({ countdown }) => {
  console.log('Countdown received:', countdown);
  if (countdown > 0) {
    $countdownDisplay.textContent = countdown;
    $countdownDisplay.style.display = 'block';
    console.log('Countdown displayed:', countdown);
  } else {
    $countdownDisplay.style.display = 'none';
    console.log('Countdown hidden');
  }
});

socket.on('game_started', ({ startedAt, revealAt, settings: s, currentRound, totalRounds }) => {
  console.log('Game started event received:', { startedAt, revealAt, currentRound, totalRounds });
  console.log('Current view before switch:', {
    join: $join.style.display,
    lobby: $lobby.style.display,
    play: $play.style.display,
    results: $results.style.display
  });
  setError('');
  settings = s;
  gameTimes = { startedAt, revealAt };
  $costLabel2.textContent = settings.costPerPoint;
  clickCostTotal = 0; // reset cost accumulator each round
  roundInfo = { current: currentRound || 0, total: totalRounds || 0 };
  $roundLabel.textContent = `${roundInfo.current}/${roundInfo.total}`;
  myPoints = [];
  updateMyPointsUI();
  renderBoard();
  hasSubmitted = false; // Reset submission flag
  $readyStatus.textContent = '';
  $nextRoundBtn.disabled = true;
  $nextRoundBtn.textContent = 'Next Round';
  if ($nextRoundBtn) {
    $nextRoundBtn.style.display = 'none'; // only show in results view
  }
  $countdownDisplay.style.display = 'none'; // Hide countdown if still visible
  setCountdown();
  console.log('Calling show("play")');
  show('play');
  console.log('After show("play"):', {
    join: $join.style.display,
    lobby: $lobby.style.display,
    play: $play.style.display,
    results: $results.style.display
  });
});

socket.on('results', ({ results, winner, settings: s, currentRound, totalRounds, totals }) => {
  console.log('Results received:', { results, winner, currentRound, totalRounds, totals });
  setError('');
  settings = s;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  hasSubmitted = false; // Reset submission flag for next round
  
  // Ensure we're showing results view and render after layout is visible
  console.log('Switching to results view');
  show('results');
  requestAnimationFrame(() => renderReveal(results));
  if ($resultsLegend) {
    $resultsLegend.innerHTML = '';
    for (const r of results) {
      const isWinner = winner && winner.playerId === r.playerId;
      const row = document.createElement('div');
      row.className = 'legend-item';
      if (isWinner) row.classList.add('winner');
      const dot = document.createElement('div');
      dot.className = 'legend-dot';
      dot.style.background = r.color;
      dot.style.borderColor = r.color;
      const text = document.createElement('div');
      text.textContent = `${displayName(r.name, r.emoji)}: ${r.points.length} pts • payoff ${r.payoff.toFixed(4)}${isWinner ? ' • winner' : ''}`;
      row.appendChild(dot);
      row.appendChild(text);
      $resultsLegend.appendChild(row);
    }
  }
  // table
  $resultsBody.innerHTML = '';
  if (Array.isArray(totals) && totals.length) {
    const trTotals = document.createElement('tr');
    const tdTotals = document.createElement('td');
    tdTotals.colSpan = 5;
    tdTotals.innerHTML = '<strong>Cumulative payoff:</strong> ' + totals.map(t => `${displayName(t.name, t.emoji)}: ${t.totalPayoff.toFixed(4)}`).join(' | ');
    trTotals.appendChild(tdTotals);
    $resultsBody.appendChild(trTotals);
  }
  if (results.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'No points were submitted by any player.';
    td.style.textAlign = 'center';
    td.style.color = '#9aa4b2';
    tr.appendChild(td);
    $resultsBody.appendChild(tr);
  } else {
    for (const r of results) {
      const isWinner = winner && winner.playerId === r.playerId;
      const tr = document.createElement('tr');
      if (isWinner) tr.classList.add('winner-row');
      const nameTd = document.createElement('td');
      nameTd.textContent = displayName(r.name, r.emoji);
      nameTd.style.color = r.color;
      const ptsTd = document.createElement('td');
      ptsTd.textContent = r.points.length > 0 ? formatPoints(r.points) : '(none)';
      const areaTd = document.createElement('td');
      areaTd.textContent = r.area.toFixed(4);
      const costTd = document.createElement('td');
      costTd.textContent = r.cost.toFixed(4);
      const payoffTd = document.createElement('td');
      payoffTd.textContent = r.payoff.toFixed(4);
      tr.appendChild(nameTd);
      tr.appendChild(ptsTd);
      tr.appendChild(areaTd);
      tr.appendChild(costTd);
      tr.appendChild(payoffTd);
      $resultsBody.appendChild(tr);
    }
  }
  renderWinnerLabel(winner);
  roundInfo = { current: currentRound || roundInfo.current, total: totalRounds || roundInfo.total };
  $roundLabel.textContent = `${roundInfo.current}/${roundInfo.total}`;
  const moreRounds = roundInfo.current < roundInfo.total;
  if ($nextRoundBtn) {
    $nextRoundBtn.style.display = moreRounds ? 'inline-flex' : 'none';
    $nextRoundBtn.disabled = false;
    $nextRoundBtn.textContent = moreRounds ? 'Next Round' : 'Next Round';
  }
  if ($readyStatus) {
    if (moreRounds) {
      $readyStatus.textContent = 'Click Next Round to continue.';
    } else {
      $readyStatus.textContent = 'Match finished.';
    }
  }
  show('results');
  console.log('Results view displayed');
});

// Server ack that our submission was recorded
socket.on('submitted', ({ roomId: rid, points }) => {
  if (rid !== roomId) return;
  console.log('Points submitted successfully and recorded:', points);
  hasSubmitted = true; // Ensure flag is set after server confirms
});

function renderReveal(results) {
  const ctx = $reveal.getContext('2d');
  // Scale canvas for high DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = $reveal.getBoundingClientRect();
  $reveal.width = rect.width * dpr;
  $reveal.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  
  clearCanvas(ctx);
  drawAxis(ctx, width, height);
  // Build global sorted points
  const all = [];
  for (const r of results) {
    for (const x of r.points) all.push({ x, color: r.color, owner: r.name });
  }
  all.sort((a, b) => a.x - b.x);
  // draw intervals colored by the right point owner (area to the left of the point)
  const yTop = 40;
  const yBottom = height - 40;
  const pointSize = Math.max(5, Math.min(7, width / 140));
  for (let i = 0; i < all.length; i++) {
    const current = all[i];
    const prev = all[i - 1];
    const x1Val = prev ? prev.x : 0;
    const x2Val = current.x;
    const x1 = 20 + x1Val * (width - 40);
    const x2 = 20 + x2Val * (width - 40);
    if (x2 > x1) {
      const grad = ctx.createLinearGradient(x1, 0, x2, 0);
      grad.addColorStop(0, hexWithAlpha(current.color, 0.25));
      grad.addColorStop(1, hexWithAlpha(current.color, 0.12));
      ctx.fillStyle = grad;
      ctx.fillRect(x1, yTop, x2 - x1, yBottom - yTop);
      // subtle stripe overlay for ownership
      ctx.fillStyle = hexWithAlpha(current.color, 0.08);
      ctx.fillRect(x1, yTop, (x2 - x1) * 0.25, yBottom - yTop);
    }
  }
  // draw points over intervals with outline/shadow
  for (const p of all) {
    const px = 20 + p.x * (width - 40);
    const py = (yTop + yBottom) / 2;
    ctx.save();
    ctx.shadowColor = hexWithAlpha(p.color, 0.35);
    ctx.shadowBlur = 10;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px, py, pointSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
    ctx.restore();
  }
}

function hexWithAlpha(hex, alpha) {
  // Accepts #rrggbb
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Init
const initialRoom = getRoomFromLocation();
if (initialRoom) {
  $roomInput.value = initialRoom;
  myName = ($nameInputJoin?.value || $nameInput?.value || '').trim() || 'Player';
  show('join');
  joinRoomById(initialRoom, { silent: true });
} else {
  show('host');
}
renderBoard();


