/* global io */

// Allow overriding socket origin for deployments where the static site and
// Socket.IO server are on different hosts (e.g., Vercel static + separate Node).
// Set window.SOCKET_URL = 'https://your-socket-host' before loading this script.
const SOCKET_URL = window.SOCKET_URL || window.__SOCKET_URL__ || undefined;
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling']
});

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

// State
let myName = '';
let roomId = '';
let settings = { costPerPoint: 0.05, durationSec: 10 };
let gameTimes = { startedAt: 0, revealAt: 0 };
let countdownTimer = null;
let myPoints = [];
let myId = null;
let myColor = '#ff4b4b';
let roundInfo = { current: 0, total: 0 };
let isHost = false;
let inviteUrl = '';
let lastReadyCounts = { ready: 0, total: 0 };

socket.on('connect', () => {
  myId = socket.id;
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
    lastReadyCounts = { ready: 0, total: 0 };
    updateInviteLink(roomId);
    applyRoomToUrl(roomId);
    if ($roomInput) $roomInput.value = roomId;
  }
  if (s) settings = s;
  $roomIdLabel.textContent = roomId;
  $costLabel.textContent = settings.costPerPoint;
  $durationLabel.textContent = settings.durationSec;
  if ($shareRow) {
    $shareRow.style.display = isHost ? 'flex' : 'none';
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
  console.log('Submitting points:', myPoints, 'to room:', roomId);
  // Ensure roomId is sent as string, especially for room "0"
  const submitRoomId = roomId.toString().trim();
  console.log('Sending submit_points with roomId:', submitRoomId);
  socket.emit('submit_points', { roomId: submitRoomId, points: myPoints }, (res) => {
    if (!res?.ok) {
      console.error('Submit failed:', res?.error);
      hasSubmitted = false; // Allow retry if submission failed
    } else {
      console.log('Points submitted successfully to room:', submitRoomId);
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
      console.log('Auto-submitting points:', pointsToSubmit, 'Progress:', progress, 'LeftMs:', leftMs, 'RoomId:', roomId);
      
      // Submit directly without going through submitPoints to avoid hasSubmitted check
      if (!roomId) {
        console.error('Cannot submit: no room ID');
        return;
      }
      hasSubmitted = true;
      const submitRoomId = roomId.toString().trim();
      console.log('Sending submit_points with roomId:', submitRoomId, 'points:', pointsToSubmit);
      socket.emit('submit_points', { roomId: submitRoomId, points: pointsToSubmit }, (res) => {
        if (!res?.ok) {
          console.error('Submit failed:', res?.error);
          hasSubmitted = false; // Allow retry if submission failed
          submittedThisRound = false;
        } else {
          console.log('Points submitted successfully to room:', submitRoomId, 'points:', pointsToSubmit);
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
      if (!silent) alert(res?.error || 'Failed to join');
      return;
    }
    const joinedId = res.roomId || targetId;
    setRoomContext(joinedId, res.settings);
    show('lobby');
  });
}

// Interactions
$navHost?.addEventListener('click', () => show('host'));
$navJoin?.addEventListener('click', () => show('join'));

$createBtn?.addEventListener('click', () => {
  myName = ($nameInput.value || '').trim() || 'Host';
  const costPerPoint = parseFloat($costInput.value || '0.05');
  const durationSec = parseInt($durInput.value || '10', 10);
  socket.emit('create_room', { name: myName, costPerPoint, durationSec }, (res) => {
    if (!res?.ok) { alert(res?.error || 'Failed to create'); return; }
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
  // Immediately mark as ready when clicked
  if ($startBtn.textContent === 'Start Round' || $startBtn.textContent.includes('Ready')) {
    $startBtn.disabled = true;
    $startBtn.textContent = 'Ready ✓';
    socket.emit('ready_to_start', { roomId }, (res) => {
      if (res && !res.ok) {
        alert(res.error || 'Cannot ready up');
        $startBtn.disabled = false;
        $startBtn.textContent = 'Ready / Start';
      }
    });
  }
});

// Submit button removed - auto-submit when line reaches end

$backToLobbyBtn.addEventListener('click', () => {
  show('lobby');
});

$nextRoundBtn.addEventListener('click', () => {
  if (!roomId) return;
  $nextRoundBtn.disabled = true;
  $nextRoundBtn.textContent = 'Ready ✓';
  $readyStatus.textContent = 'Waiting for others...';
  socket.emit('ready_next', { roomId }, (res) => {
    if (!res?.ok) {
      alert(res?.error || 'Failed to ready up');
      $nextRoundBtn.disabled = false;
      $nextRoundBtn.textContent = 'Next Round';
      $readyStatus.textContent = '';
    }
  });
});

socket.on('ready_status', ({ readyCount, totalPlayers }) => {
  $readyStatus.textContent = `Ready ${readyCount}/${totalPlayers}`;
});

socket.on('match_finished', ({ totals, totalRounds, winner }) => {
  const summary = Array.isArray(totals) && totals.length
    ? ' | ' + totals.map(t => `${t.name}: ${t.totalPayoff.toFixed(4)}`).join(' | ')
    : '';
  const winnerText = winner ? ` Winner: ${winner.name} (${winner.totalPayoff.toFixed(4)}).` : '';
  $readyStatus.textContent = `Match finished (${totalRounds} rounds).${winnerText}${summary}`;
  $nextRoundBtn.style.display = 'none';
});

// Canvas click to add points only (no removal)
$board.addEventListener('click', (e) => {
  // Add point at the current red line position
  const linePosition = getCurrentLinePosition();
  if (linePosition !== null) {
    const eps = 0.02; // ~2% of the segment width
    // Check if there's already a point at the line position
    const existingIdx = myPoints.findIndex((p) => Math.abs(p - linePosition) < eps);
    if (existingIdx < 0) {
      // Only add if point doesn't already exist at this position
      myPoints.push(linePosition);
      myPoints.sort((a, b) => a - b);
      updateMyPointsUI();
      renderBoard();
      flashCost(e.clientX, e.clientY);
    }
  }
});

function flashCost(clientX, clientY) {
  const el = document.createElement('div');
  el.className = 'cost-flash';
  el.textContent = '-$1';
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  el.style.transform = 'translate(-50%, -50%) translateY(0px)';
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) translateY(-8px)';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -50%) translateY(-16px)';
    setTimeout(() => {
      el.remove();
    }, 180);
  }, 250);
}

// Socket listeners
socket.on('lobby', ({ roomId: rid, players, settings: s }) => {
  setRoomContext(rid, s);
  $players.innerHTML = '';
  for (const p of players) {
    const span = document.createElement('span');
    span.className = 'pill';
    span.style.borderColor = p.color;
    span.textContent = p.name;
    $players.appendChild(span);
  }
  const me = players.find((p) => p.id === myId);
  if (me) {
    myColor = me.color;
    renderBoard();
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
  show('lobby');
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
  settings = s;
  gameTimes = { startedAt, revealAt };
  $costLabel2.textContent = settings.costPerPoint;
  roundInfo = { current: currentRound || 0, total: totalRounds || 0 };
  $roundLabel.textContent = `${roundInfo.current}/${roundInfo.total}`;
  myPoints = [];
  updateMyPointsUI();
  renderBoard();
  hasSubmitted = false; // Reset submission flag
  $readyStatus.textContent = '';
  $nextRoundBtn.disabled = false;
  $nextRoundBtn.textContent = 'Next Round';
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
  settings = s;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  hasSubmitted = false; // Reset submission flag for next round
  
  // Ensure we're showing results view
  console.log('Switching to results view');
  renderReveal(results);
  if ($resultsLegend) {
    $resultsLegend.innerHTML = '';
    for (const r of results) {
      const row = document.createElement('div');
      row.className = 'legend-item';
      const dot = document.createElement('div');
      dot.className = 'legend-dot';
      dot.style.background = r.color;
      dot.style.borderColor = r.color;
      const text = document.createElement('div');
      text.textContent = `${r.name}: ${r.points.length} pts • payoff ${r.payoff.toFixed(4)}`;
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
    tdTotals.innerHTML = '<strong>Cumulative payoff:</strong> ' + totals.map(t => `${t.name}: ${t.totalPayoff.toFixed(4)}`).join(' | ');
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
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.textContent = r.name;
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
  $winnerLabel.textContent = winner ? `Winner: ${winner.name} (payoff: ${winner.payoff.toFixed(4)})` : 'No winner (no submissions)';
  roundInfo = { current: currentRound || roundInfo.current, total: totalRounds || roundInfo.total };
  $roundLabel.textContent = `${roundInfo.current}/${roundInfo.total}`;
  if (roundInfo.current < roundInfo.total) {
    $nextRoundBtn.style.display = 'inline-block';
    $nextRoundBtn.disabled = false;
    $readyStatus.textContent = '';
  } else {
    $nextRoundBtn.style.display = 'none';
    $readyStatus.textContent = 'Match finished.';
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
  // draw intervals colored by left point owner
  const yTop = 40;
  const yBottom = height - 40;
  const pointSize = Math.max(4, Math.min(6, width / 150));
  for (let i = 0; i < all.length; i++) {
    const left = all[i];
    const right = all[i + 1];
    const x1 = 20 + left.x * (width - 40);
    const x2 = right ? 20 + right.x * (width - 40) : 20 + 1 * (width - 40);
    if (x2 > x1) {
      ctx.fillStyle = hexWithAlpha(left.color, 0.25);
      ctx.fillRect(x1, yTop, x2 - x1, yBottom - yTop);
    }
  }
  // draw points over intervals
  for (const p of all) {
    const px = 20 + p.x * (width - 40);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px, (yTop + yBottom) / 2, pointSize, 0, Math.PI * 2);
    ctx.fill();
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


