const SUPABASE_URL = 'https://wncodurkmacfkubnhyhi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_egPhfy4nWgh5Ci0_RGnMhQ_1rJ8J-_k';

const RANKS = [
  { name:'IRON',     icon:'🩶', min:0     },
  { name:'BRONZE',   icon:'🥉', min:1000  },
  { name:'SILVER',   icon:'🥈', min:3000  },
  { name:'GOLD',     icon:'🥇', min:6000  },
  { name:'PLATINUM', icon:'💎', min:9500  },
  { name:'DIAMOND',  icon:'💠', min:13000 },
  { name:'MASTER',   icon:'🔮', min:16500 },
  { name:'IMMORTAL', icon:'👑', min:20000 },
];

function getRank(s) {
  for (let i = RANKS.length - 1; i >= 0; i--)
    if (s >= RANKS[i].min) return RANKS[i];
  return RANKS[0];
}

function getRankProgress(score) {
  const idx     = RANKS.findIndex(r => r.name === getRank(score).name);
  const current = RANKS[idx];
  const next    = RANKS[idx + 1] || null;
  if (!next) return { pct:100, current, next:null, pointsNeeded:0 };
  const pct = Math.min(100, Math.round(((score - current.min) / (next.min - current.min)) * 100));
  return { pct, current, next, pointsNeeded: next.min - score };
}

// ── SETTINGS with persistence ────────────────────────────
const settings = {
  size:60, speed:5, spawn:800, sound:true,
  crosshair: localStorage.getItem('crosshair') || 'classic',
  difficulty: localStorage.getItem('traceDifficulty') || 'medium'
};

function updateSetting(key, val) {
  settings[key] = Number(val);
  document.getElementById(key + '-val').textContent = val;
}
function toggleSettings() {
  const body  = document.getElementById('settings-body');
  const arrow = document.getElementById('settings-arrow');
  const open  = body.style.display === 'none';
  body.style.display = open ? 'flex' : 'none';
  arrow.textContent  = open ? '▲' : '▼';
}
function toggleSound() {
  settings.sound = !settings.sound;
  const btn = document.getElementById('sound-toggle');
  btn.textContent = settings.sound ? 'ON' : 'OFF';
  btn.classList.toggle('off', !settings.sound);
}

// ── SOUND ENGINE ─────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playHit() {
  if (!settings.sound) return;
  try {
    const ctx = getAudio(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(800, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    o.start(); o.stop(ctx.currentTime + 0.1);
  } catch(e) {}
}
function playMiss() {
  if (!settings.sound) return;
  try {
    const ctx = getAudio(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, ctx.currentTime);
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    o.start(); o.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}
function playReaction(ms) {
  if (!settings.sound) return;
  try {
    const ctx = getAudio(), freq = ms < 200 ? 1200 : ms < 300 ? 900 : 600;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    o.start(); o.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

// ── ANTI-CHEAT ────────────────────────────────────────────
const MAX_SCORE = 24000, MAX_HITS = 250, MIN_MS_PER_HIT = 120;

// ── STATE ─────────────────────────────────────────────────
let currentUser = null, currentProfile = null, selectedMode = 'static';
let score = 0, hits = 0, misses = 0, timeLeft = 30;
let gameTimer = null, spawnTimer = null, isGameRunning = false;
let lastHitTime = 0, sessionStartTime = 0, hitTimestamps = [];
let reactionTimes = [], reactionState = 'idle', reactionTimeout = null;
let streak = 0, bestStreak = 0;
let trackingFrameId = null;
let trackingMonitorInterval = null;
let currentLbTab = 'static';
const HUD_HEIGHT = 65;

const RANKED_MODES = ['static','flick','tracking','switching','reaction'];
const ALL_MODES    = [...RANKED_MODES, 'trace'];

// ── SUPABASE HELPER ───────────────────────────────────────
async function supabase(path, opts = {}, token = null) {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token || currentUser?.access_token || SUPABASE_KEY}`
    }
  });
  const text = await res.text();
  try { return { ok:res.ok, data:JSON.parse(text) }; }
  catch { return { ok:res.ok, data:text }; }
}

async function fetchGlobalRank(score) {
  try {
    const { ok, data } = await supabase(
      `/rest/v1/profiles?best_score=gt.${score}&select=id&limit=1000`
    );
    if (ok && Array.isArray(data)) return data.length + 1;
  } catch(e) {}
  return null;
}

async function fetchModeRank(mode, userScore) {
  if (!userScore || userScore <= 0) return null;
  try {
    const { ok, data } = await supabase(
      `/rest/v1/scores?mode=eq.${mode}&score=gt.${userScore}&select=id&limit=1000`
    );
    if (ok && Array.isArray(data)) return data.length + 1;
  } catch(e) {}
  return null;
}

// ── AUTO-LOGIN / SESSION MANAGEMENT ───────────────────────
function saveSession(user) {
  if (user) {
    localStorage.setItem('aimlab_user', JSON.stringify({
      id: user.id,
      access_token: user.access_token,
      email: user.email
    }));
  } else {
    localStorage.removeItem('aimlab_user');
  }
}

async function tryAutoLogin() {
  const saved = localStorage.getItem('aimlab_user');
  if (!saved) return false;
  try {
    const user = JSON.parse(saved);
    if (!user.access_token) return false;
    // Verify token by fetching profile
    const prof = await supabase(`/rest/v1/profiles?id=eq.${user.id}&select=*`, {}, user.access_token);
    if (!prof.ok || !prof.data?.length) {
      // Token expired or invalid
      localStorage.removeItem('aimlab_user');
      return false;
    }
    currentUser = { id: user.id, access_token: user.access_token, email: user.email };
    currentProfile = prof.data[0];
    await enterMenu();
    return true;
  } catch(e) {
    localStorage.removeItem('aimlab_user');
    return false;
  }
}

// ── AUTH ──────────────────────────────────────────────────
async function register() {
  const username = document.getElementById('reg-username').value.trim().toUpperCase();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('register-error');
  const btn      = document.querySelector('#tab-register .btn-primary');
  errEl.textContent = ''; btn.querySelector('span').textContent = 'CREATING...'; btn.disabled = true;
  try {
    if (!username || username.length < 3) throw new Error('Username must be at least 3 characters.');
    if (!/^[A-Z0-9_]+$/.test(username))  throw new Error('Letters, numbers, underscores only.');
    if (!email.includes('@'))             throw new Error('Enter a valid email.');
    if (password.length < 6)             throw new Error('Password must be at least 6 characters.');
    const check = await supabase(`/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`, {}, SUPABASE_KEY);
    if (check.ok && Array.isArray(check.data) && check.data.length > 0) throw new Error('Username already taken.');
    const auth = await supabase('/auth/v1/signup', { method:'POST', body:JSON.stringify({ email, password }) }, SUPABASE_KEY);
    if (!auth.ok || !auth.data?.user?.id) throw new Error(auth.data?.msg || auth.data?.error_description || 'Registration failed.');
    const uid = auth.data.user.id, token = auth.data.access_token;
    const profData = {
      id:uid, username, best_score:0, total_hits:0, games_played:0,
      best_static:0, best_flick:0, best_tracking:0, best_switching:0, best_reaction:0
    };
    const profRes = await supabase('/rest/v1/profiles', { method:'POST', body:JSON.stringify(profData) }, token);
    if (!profRes.ok) throw new Error('Account created but profile save failed. Try logging in.');
    currentUser    = { id:uid, access_token:token, email };
    currentProfile = profData;
    saveSession(currentUser);
    await enterMenu();
  } catch(e) { errEl.textContent = e.message; }
  finally    { btn.querySelector('span').textContent = 'CREATE ACCOUNT'; btn.disabled = false; }
}

async function login() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.querySelector('#tab-login .btn-primary');
  errEl.textContent = ''; btn.querySelector('span').textContent = 'LOGGING IN...'; btn.disabled = true;
  try {
    if (!email.includes('@')) throw new Error('Enter a valid email.');
    if (!password)            throw new Error('Enter your password.');
    const auth = await supabase('/auth/v1/token?grant_type=password', { method:'POST', body:JSON.stringify({ email, password }) }, SUPABASE_KEY);
    if (!auth.ok || !auth.data?.access_token) throw new Error(auth.data?.error_description || auth.data?.msg || 'Invalid email or password.');
    currentUser = { id:auth.data.user.id, access_token:auth.data.access_token, email };
    const prof  = await supabase(`/rest/v1/profiles?id=eq.${currentUser.id}&select=*`, {}, auth.data.access_token);
    if (!prof.ok || !prof.data?.length) throw new Error('Profile not found. Please re-register.');
    currentProfile = prof.data[0];
    saveSession(currentUser);
    await enterMenu();
  } catch(e) { errEl.textContent = e.message; }
  finally    { btn.querySelector('span').textContent = 'LOGIN'; btn.disabled = false; }
}

function logout() {
  currentUser = null;
  currentProfile = null;
  saveSession(null);
  showScreen('auth-screen');
}

async function enterMenu() {
  const rank    = getRank(currentProfile.best_score);
  const prog    = getRankProgress(currentProfile.best_score);
  const globalR = await fetchGlobalRank(currentProfile.best_score);

  document.getElementById('badge-username').textContent  = currentProfile.username;
  document.getElementById('badge-rank-icon').textContent = rank.icon;
  document.getElementById('badge-rank-name').textContent = rank.name;
  document.getElementById('badge-best').textContent      = 'Best: ' + currentProfile.best_score.toLocaleString();
  document.getElementById('badge-global-rank').textContent =
    globalR ? '🌍 RANK #' + globalR : '';
  document.getElementById('badge-rank-fill').style.width = prog.pct + '%';
  document.getElementById('badge-rank-next').textContent = prog.next
    ? prog.pointsNeeded.toLocaleString() + ' pts → ' + prog.next.name
    : '✦ MAX RANK';

  showScreen('menu-screen');
}

function switchTab(tab) {
  document.getElementById('tab-login').style.display    = tab === 'login'    ? 'flex' : 'none';
  document.getElementById('tab-register').style.display = tab === 'register' ? 'flex' : 'none';
  document.querySelectorAll('.auth-tab').forEach((el, i) =>
    el.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='register')));
}

function selectMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mode-' + mode).classList.add('active');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── PROFILE SCREEN ────────────────────────────────────────
async function showProfile() {
  showScreen('profile-screen');
  const p    = currentProfile;
  const rank = getRank(p.best_score);
  const prog = getRankProgress(p.best_score);

  document.getElementById('prof-rank-icon').textContent = rank.icon;
  document.getElementById('prof-username').textContent  = p.username;
  document.getElementById('prof-rank-name').textContent = rank.name;
  document.getElementById('prof-games').textContent     = (p.games_played || 0).toLocaleString();
  document.getElementById('prof-total-hits').textContent= (p.total_hits   || 0).toLocaleString();
  document.getElementById('prof-best').textContent      = (p.best_score   || 0).toLocaleString();

  document.getElementById('prof-progress-fill').style.width = prog.pct + '%';
  document.getElementById('prof-cur-rank').textContent  = rank.icon + ' ' + rank.name;
  document.getElementById('prof-next-rank').textContent = prog.next ? prog.next.icon + ' ' + prog.next.name : '✦ MAX';
  document.getElementById('prof-progress-label').textContent =
    prog.next ? `${p.best_score.toLocaleString()} / ${prog.next.min.toLocaleString()}` : 'MAX RANK';
  document.getElementById('prof-progress-sub').textContent = prog.next
    ? `${prog.pct}% — ${prog.pointsNeeded.toLocaleString()} points to ${prog.next.name}`
    : 'You have reached the highest rank!';

  document.getElementById('prof-global').textContent = 'LOADING RANK...';
  const globalR = await fetchGlobalRank(p.best_score);
  document.getElementById('prof-global').textContent =
    globalR ? '🌍 GLOBAL RANK #' + globalR : '🌍 GLOBAL RANK —';

  for (const mode of RANKED_MODES) {
    const modeScore = p['best_' + mode] || 0;
    const scoreEl   = document.getElementById('prof-best-' + mode);
    const rankEl    = document.getElementById('prof-rank-' + mode);
    if (!scoreEl || !rankEl) continue;
    scoreEl.textContent = modeScore.toLocaleString();
    rankEl.textContent  = '...';
    fetchModeRank(mode, modeScore).then(r => {
      if (!rankEl) return;
      rankEl.textContent = r ? '#' + r + ' in mode' : modeScore > 0 ? '—' : '—';
    });
  }

  const traceEl = document.getElementById('prof-best-trace');
  if (traceEl) traceEl.textContent = '—';
}

// ── GAME START ────────────────────────────────────────────
function startGame() {
  if (!currentUser || !currentProfile) return showScreen('auth-screen');
  score = 0; hits = 0; misses = 0; timeLeft = 30; lastHitTime = 0; streak = 0; bestStreak = 0;
  hitTimestamps = []; reactionTimes = [];
  sessionStartTime = Date.now();
  isGameRunning = true;
  stopTracking();
  if (trackingMonitorInterval) clearInterval(trackingMonitorInterval);
  trackingMonitorInterval = null;

  updateHUD(); clearGameArea();
  showScreen('game-screen');
  document.getElementById('timer-display').classList.remove('urgent');
  document.getElementById('mode-label-hud').textContent = selectedMode.toUpperCase();

  if (selectedMode === 'reaction') { startReactionMode(); return; }
  if (selectedMode === 'trace')    { startTraceMode();    return; }

  document.getElementById('reaction-overlay').style.display = 'none';

  gameTimer = setInterval(() => {
    timeLeft--;
    document.getElementById('timer-display').textContent = timeLeft;
    if (timeLeft <= 5) document.getElementById('timer-display').classList.add('urgent');
    if (timeLeft <= 0) endGame();
  }, 1000);

  const intervals = { static:900, flick:950, tracking:1800, switching:550 };
  spawnTimer = setInterval(spawnTarget, intervals[selectedMode] || settings.spawn);
  spawnTarget();

  if (selectedMode === 'tracking') {
    startTracking();
    trackingMonitorInterval = setInterval(() => {
      if (!isGameRunning) return;
      const existing = document.querySelectorAll('.target.tracking');
      if (existing.length < 2) spawnTarget();
    }, 4000);
  }
  if (selectedMode === 'switching') { setTimeout(spawnTarget,200); setTimeout(spawnTarget,400); }
}

// ── TRACKING ─────────────────────────────────────────────
function startTracking() {
  const BASE_SPEED = 3.2;
  function moveTargets() {
    if (!isGameRunning) return;
    const ga = document.getElementById('game-area');
    const W = ga.offsetWidth, H = ga.offsetHeight;
    document.querySelectorAll('.target.tracking').forEach(t => {
      let angle = parseFloat(t.dataset.angle) || Math.random() * Math.PI * 2;
      let spd   = parseFloat(t.dataset.spd)   || BASE_SPEED;
      let x     = parseFloat(t.style.left);
      let y     = parseFloat(t.style.top);
      const r   = 30;
      angle += (Math.random() - 0.5) * 0.06;
      x += Math.cos(angle) * spd;
      y += Math.sin(angle) * spd;
      if (x < r)   { x = r;   angle = Math.PI - angle + (Math.random()-0.5)*0.3; }
      if (x > W-r) { x = W-r; angle = Math.PI - angle + (Math.random()-0.5)*0.3; }
      if (y < HUD_HEIGHT+r) { y = HUD_HEIGHT+r; angle = -angle + (Math.random()-0.5)*0.3; }
      if (y > H-r)          { y = H-r;          angle = -angle + (Math.random()-0.5)*0.3; }
      t.style.left = x + 'px';
      t.style.top  = y + 'px';
      t.dataset.angle = angle;
      t.dataset.spd   = spd;
    });
    trackingFrameId = requestAnimationFrame(moveTargets);
  }
  trackingFrameId = requestAnimationFrame(moveTargets);
}
function stopTracking() {
  if (trackingFrameId) cancelAnimationFrame(trackingFrameId);
  trackingFrameId = null;
  if (trackingMonitorInterval) clearInterval(trackingMonitorInterval);
  trackingMonitorInterval = null;
}

// ── REACTION MODE ────────────────────────────────────────
let reactionRound = 0, reactionMax = 10;
function startReactionMode() {
  reactionRound = 0; reactionTimes = [];
  document.getElementById('reaction-overlay').style.display = 'flex';
  document.getElementById('reaction-scores').innerHTML = '';
  document.getElementById('reaction-time').textContent = '';
  nextReaction();
  gameTimer = setInterval(() => {
    timeLeft--;
    document.getElementById('timer-display').textContent = timeLeft;
    if (timeLeft <= 0) endGame();
  }, 1000);
}
function nextReaction() {
  if (reactionRound >= reactionMax) { endGame(); return; }
  reactionState = 'waiting';
  const msg = document.getElementById('reaction-msg');
  msg.textContent = 'WAIT FOR GREEN...'; msg.className = 'reaction-msg';
  document.getElementById('reaction-time').textContent = '';
  clearGameArea();
  const delay = 500 + Math.random()*1500;
  reactionTimeout = setTimeout(() => {
    if (!isGameRunning) return;
    const target = document.createElement('div');
    target.className = 'target';
    const ga = document.getElementById('game-area'), sz = settings.size;
    const x = Math.random()*(ga.offsetWidth-sz*2)+sz;
    const y = Math.random()*(ga.offsetHeight-sz*2-HUD_HEIGHT)+sz+HUD_HEIGHT;
    target.style.cssText = `width:${sz}px;height:${sz}px;left:${x}px;top:${y}px;`;
    target.innerHTML = '<div class="target-inner" style="background:radial-gradient(circle at 35% 30%,#00ff88,#00aa55);border-color:rgba(0,255,136,0.8);box-shadow:0 0 20px rgba(0,255,100,0.7)"></div>';
    target.addEventListener('mousedown', e => { e.stopPropagation(); handleReactionHit(); });
    ga.appendChild(target);
    msg.textContent = 'CLICK!'; msg.className = 'reaction-msg go';
    reactionState = 'go'; lastHitTime = Date.now();
  }, delay);
}
function handleReactionHit() {
  if (!isGameRunning || reactionState !== 'go') return;
  const ms = Date.now() - lastHitTime;
  reactionTimes.push(ms);
  reactionState = 'idle'; reactionRound++;
  hits++; score += Math.max(200, Math.round(2500 - ms*4));
  updateHUD(); playReaction(ms); clearGameArea();
  document.getElementById('reaction-time').textContent = ms+'ms';
  addReactionPill(ms+'ms');
  const msg = document.getElementById('reaction-msg');
  msg.textContent = ms<180?'GODLIKE!':ms<250?'FAST!':ms<380?'GOOD':ms<550?'OKAY':'SLOW...';
  msg.className = 'reaction-msg go';
  setTimeout(nextReaction, 1200);
}
function handleEarlyReactionClick() {
  if (!isGameRunning || reactionState !== 'waiting') return;
  clearTimeout(reactionTimeout);
  const msg = document.getElementById('reaction-msg');
  msg.textContent = 'TOO EARLY!'; msg.className = 'reaction-msg early';
  playMiss();
  misses++;
  updateHUD();
  addReactionPill('EARLY');
  reactionRound++;
  setTimeout(nextReaction, 1000);
}
function addReactionPill(text) {
  const el = document.createElement('div');
  el.className = 'reaction-score-pill'; el.textContent = text;
  document.getElementById('reaction-scores').appendChild(el);
}

// ── SPAWN TARGET ─────────────────────────────────────────
function spawnTarget() {
  if (!isGameRunning || selectedMode === 'reaction' || selectedMode === 'trace') return;
  if (selectedMode === 'tracking' &&
      document.querySelectorAll('.target.tracking').length >= 6) return;

  const ga = document.getElementById('game-area');
  const sz = settings.size, margin = sz;
  const x  = Math.random()*(ga.offsetWidth  - margin*2) + margin;
  const y  = Math.random()*(ga.offsetHeight - margin*2 - HUD_HEIGHT) + margin + HUD_HEIGHT;

  if (selectedMode === 'switching') {
    document.querySelectorAll('.target.priority').forEach(t => t.classList.remove('priority'));
    const existing = document.querySelectorAll('.target.switching');
    if (existing.length > 0) existing[Math.floor(Math.random()*existing.length)].classList.add('priority');
  }

  const target = document.createElement('div');
  target.className = 'target ' + (
    selectedMode==='tracking'  ? 'tracking'  :
    selectedMode==='switching' ? 'switching' :
    selectedMode==='flick'     ? 'flick'     : ''
  );
  target.style.cssText = `width:${sz}px;height:${sz}px;left:${x}px;top:${y}px`;
  if (selectedMode==='tracking') {
    target.dataset.angle = Math.random() * Math.PI * 2;
    target.dataset.spd   = 2.5 + Math.random() * 2;
    setTimeout(() => { if (target.parentNode) target.remove(); }, 8000);
  }
  target.innerHTML = '<div class="target-inner"></div>';
  target.addEventListener('mousedown', e => { e.stopPropagation(); hitTarget(target); });
  ga.appendChild(target);

  const ttl = { static:2200, flick:780, tracking:99999, switching:2800 };
  if (selectedMode !== 'tracking')
    setTimeout(() => { if (target.parentNode) target.remove(); }, ttl[selectedMode]||2500);
}

// ── HIT ──────────────────────────────────────────────────
function hitTarget(el) {
  if (!isGameRunning) return;
  const now = Date.now();
  hitTimestamps.push(now);
  const timeSinceLast = lastHitTime ? now-lastHitTime : 9999;
  lastHitTime = now;
  streak++; if (streak > bestStreak) bestStreak = streak;
  let points = 150, bonusText = null;
  if (timeSinceLast < 350)     { points += 120; bonusText = '+120 FAST!'; }
  else if (timeSinceLast < 650){ points += 60;  bonusText = '+60 QUICK';  }
  if (selectedMode === 'flick')    points = Math.round(points * 2.0);
  if (selectedMode === 'tracking') points = Math.round(points * 1.6);
  if (selectedMode === 'switching' && el.classList.contains('priority')) { points += 180; bonusText = '+180 PRIORITY!'; }
  const streakMult = 1 + Math.min(0.5, Math.floor(streak / 5) * 0.1);
  points = Math.round(points * streakMult);
  hits++; score += points; updateHUD(); playHit();

  const rect = el.getBoundingClientRect();
  const gaRect = document.getElementById('game-area').getBoundingClientRect();
  const popX = rect.left - gaRect.left + rect.width/2;
  const popY = rect.top  - gaRect.top  + rect.height/2;
  showScorePopup(popX, popY, '+'+points, false);
  if (bonusText) showScorePopup(popX, popY-36, bonusText, true);
  if (streak >= 3) showStreakLabel(popX, popY+36, streak);
  showHitRing(popX, popY);
  el.remove();

  if (selectedMode === 'tracking' && isGameRunning) {
    setTimeout(() => spawnTarget(), 50);
  }
}

// ── MISS ─────────────────────────────────────────────────
function missClick(e) {
  if (!isGameRunning) return;
  if (selectedMode === 'reaction') {
    if (reactionState === 'waiting') {
      handleEarlyReactionClick();
      return;
    }
    return;
  }
  if (e.target.classList.contains('target') ||
      e.target.classList.contains('target-inner')) return;
  misses++; streak = 0; updateHUD(); playMiss();
  const flash = document.getElementById('miss-flash');
  if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 150); }
}

// ── VALIDATE ──────────────────────────────────────────────
function validateScore() {
  if (selectedMode === 'trace') return { valid:false, reason:'TRACE IS TRAINING ONLY — not ranked' };
  const ms = Date.now() - sessionStartTime;
  if (ms < 25000)        return { valid:false, reason:'Session too short' };
  if (score > MAX_SCORE) return { valid:false, reason:'Score exceeds maximum' };
  if (hits  > MAX_HITS)  return { valid:false, reason:'Hit count exceeds maximum' };
  for (let i=1; i<hitTimestamps.length; i++)
    if (hitTimestamps[i]-hitTimestamps[i-1] < MIN_MS_PER_HIT)
      return { valid:false, reason:'Inhuman click speed detected' };
  const total = hits+misses;
  if (total>0 && hits/total>0.999 && hits>20)
    return { valid:false, reason:'Suspicious accuracy' };
  return { valid:true };
}

// ── END GAME ─────────────────────────────────────────────
async function endGame() {
  if (!isGameRunning) return;
  isGameRunning = false;
  clearInterval(gameTimer); clearInterval(spawnTimer);
  clearTimeout(reactionTimeout); stopTracking(); stopTraceMode(); clearGameArea();
  document.getElementById('reaction-overlay').style.display = 'none';

  const total    = hits+misses;
  const accuracy = total>0 ? Math.round((hits/total)*100) : 0;
  const validR   = reactionTimes.filter(t=>t<999);
  const avgReact = validR.length>0 ? Math.round(validR.reduce((a,b)=>a+b,0)/validR.length) : null;

  document.getElementById('final-score').textContent    = score;
  document.getElementById('final-hits').textContent     = hits;
  document.getElementById('final-accuracy').textContent = accuracy+'%';
  document.getElementById('final-react').textContent    = avgReact ? avgReact+'ms' : '—';
  document.getElementById('results-name-display').textContent = currentProfile.username;

  const rank = getRank(score);
  document.getElementById('result-rank-icon').textContent = rank.icon;
  document.getElementById('result-rank-name').textContent = rank.name;
  document.getElementById('new-best-banner').style.display =
    score > currentProfile.best_score ? 'block' : 'none';

  const prog = getRankProgress(score);
  const rp   = document.getElementById('result-rank-progress');
  rp.style.display = 'block';
  document.getElementById('rrp-cur').textContent  = rank.icon + ' ' + rank.name;
  document.getElementById('rrp-next').textContent = prog.next ? prog.next.icon+' '+prog.next.name : '✦ MAX';
  document.getElementById('rrp-sub').textContent  = prog.next
    ? `${prog.pct}% — ${prog.pointsNeeded.toLocaleString()} pts to ${prog.next.name}`
    : 'Maximum rank achieved!';
  document.getElementById('rrp-fill').style.width = '0%';
  document.getElementById('rrp-pct').textContent  = prog.pct + '%';
  setTimeout(() => { document.getElementById('rrp-fill').style.width = prog.pct+'%'; }, 200);

  showScreen('results-screen');

  const statusEl = document.getElementById('submit-status');
  statusEl.textContent = 'VALIDATING & SUBMITTING...'; statusEl.className = 'submit-status';

  const check = validateScore();
  if (!check.valid) {
    statusEl.textContent = '⚠ ' + check.reason;
    statusEl.className   = 'submit-status error';
    return;
  }

  try {
    const ins = await supabase('/rest/v1/scores', {
      method:'POST',
      body:JSON.stringify({ user_id:currentUser.id, name:currentProfile.username, score, accuracy, hits, mode:selectedMode })
    });
    if (!ins.ok) throw new Error(JSON.stringify(ins.data));

    const newBest     = Math.max(score, currentProfile.best_score);
    const modeCol     = 'best_' + selectedMode;
    const oldModeBest = currentProfile[modeCol] || 0;
    const newModeBest = Math.max(score, oldModeBest);
    const newHits     = (currentProfile.total_hits   || 0) + hits;
    const newGames    = (currentProfile.games_played || 0) + 1;

    const patch = { best_score:newBest, total_hits:newHits, games_played:newGames, [modeCol]:newModeBest };
    await supabase(`/rest/v1/profiles?id=eq.${currentUser.id}`, { method:'PATCH', body:JSON.stringify(patch) });

    currentProfile.best_score   = newBest;
    currentProfile.total_hits   = newHits;
    currentProfile.games_played = newGames;
    currentProfile[modeCol]     = newModeBest;

    const rankUpd = getRank(newBest);
    const progUpd = getRankProgress(newBest);
    document.getElementById('badge-best').textContent      = 'Best: '+newBest.toLocaleString();
    document.getElementById('badge-rank-icon').textContent = rankUpd.icon;
    document.getElementById('badge-rank-name').textContent = rankUpd.name;
    document.getElementById('badge-rank-fill').style.width = progUpd.pct+'%';
    document.getElementById('badge-rank-next').textContent = progUpd.next
      ? progUpd.pointsNeeded.toLocaleString()+' pts → '+progUpd.next.name
      : '✦ MAX RANK';

    statusEl.textContent = '✓ SCORE SUBMITTED'; statusEl.className = 'submit-status success';

    const modeRank = await fetchModeRank(selectedMode, score);
    const modeRankEl = document.getElementById('result-mode-rank');
    if (modeRank) {
      document.getElementById('result-mode-rank-text').textContent =
        `🎯 YOU ARE RANK #${modeRank} GLOBALLY IN ${selectedMode.toUpperCase()} MODE`;
      modeRankEl.style.display = 'block';
    }

    const globalR = await fetchGlobalRank(newBest);
    if (globalR) document.getElementById('badge-global-rank').textContent = '🌍 RANK #'+globalR;

  } catch(e) {
    statusEl.textContent = 'Error: '+e.message; statusEl.className = 'submit-status error';
  }
}

// ── LEADERBOARD ───────────────────────────────────────────
async function showLeaderboard() {
  showScreen('leaderboard-screen');
  loadLeaderboard();
}

function switchLbMode(mode) {
  currentLbTab = mode;
  document.querySelectorAll('.lb-tab').forEach((t, i) => {
    t.classList.toggle('active', RANKED_MODES[i] === mode);
  });
  loadLeaderboard();
}

async function loadLeaderboard() {
  const list        = document.getElementById('lb-list');
  const yourRankEl  = document.getElementById('lb-your-rank');
  const yourRankNum = document.getElementById('lb-your-rank-num');
  list.innerHTML = '<div class="lb-loading">FETCHING SCORES...</div>';
  yourRankEl.style.display = 'none';

  const modeCol = 'best_' + currentLbTab;

  try {
    const { ok, data } = await supabase(
      `/rest/v1/profiles?select=username,${modeCol},games_played&${modeCol}=gt.0&order=${modeCol}.desc&limit=50`
    );

    if (!ok || !Array.isArray(data) || !data.length) {
      list.innerHTML = '<div class="lb-loading">No scores yet for this mode — be the first!</div>';
      return;
    }

    const medals = ['🥇','🥈','🥉'], rc = ['r1','r2','r3'], rowC = ['top1','top2','top3'];
    const myName = currentProfile?.username || '';

    list.innerHTML = `
      <div class="lb-header">
        <span>#</span>
        <span>NAME</span>
        <span style="text-align:right">BEST SCORE</span>
        <span style="text-align:right">RANK</span>
        <span style="text-align:right">GAMES</span>
      </div>
      ${data.map((r, i) => {
        const isMe  = r.username === myName;
        const rank  = getRank(r[modeCol]);
        return `<div class="lb-row ${rowC[i]||''} ${isMe?'mine':''}">
          <span class="lb-rank ${rc[i]||''}">${i<3?medals[i]:i+1}</span>
          <span class="lb-name ${isMe?'mine-name':''}">${escHtml(r.username)}${isMe?' ◀ YOU':''}</span>
          <span class="lb-score">${(r[modeCol]||0).toLocaleString()}</span>
          <span class="lb-tier">${rank.icon} ${rank.name}</span>
          <span class="lb-acc">${r.games_played||0}</span>
        </div>`;
      }).join('')}`;

    const myPos = data.findIndex(r => r.username === myName);
    if (myPos !== -1) {
      yourRankNum.textContent    = '#' + (myPos + 1);
      yourRankEl.style.display   = 'block';
    } else {
      const myScore = currentProfile[modeCol] || 0;
      if (myScore > 0) {
        const myRank = await fetchModeRank(currentLbTab, myScore);
        if (myRank) { yourRankNum.textContent = '#'+myRank; yourRankEl.style.display = 'block'; }
      }
    }

  } catch(e) {
    list.innerHTML = '<div class="lb-loading">Could not load scores.</div>';
  }
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── VISUALS ───────────────────────────────────────────────
function showScorePopup(x, y, text, isBonus) {
  const el = document.createElement('div');
  el.className = 'score-popup'+(isBonus?' bonus':'');
  el.style.cssText = `left:${x}px;top:${y}px`;
  el.textContent = text;
  document.getElementById('game-area').appendChild(el);
  setTimeout(()=>el.remove(), 700);
}
function showHitRing(x, y) {
  const el = document.createElement('div');
  el.className = 'hit-ring';
  el.style.cssText = `left:${x}px;top:${y}px;width:${settings.size}px;height:${settings.size}px`;
  document.getElementById('game-area').appendChild(el);
  setTimeout(()=>el.remove(), 350);
}
function updateHUD() {
  document.getElementById('score-display').textContent = score.toLocaleString();
  const total = hits+misses;
  document.getElementById('acc-display').textContent =
    total>0 ? Math.round((hits/total)*100)+'%' : '—';
}
function showStreakLabel(x, y, s) {
  const el = document.createElement('div');
  el.className = 'score-popup bonus';
  el.style.cssText = `left:${x}px;top:${y}px;color:${s>=10?'#ffd700':s>=5?'#ff6b35':'#ff88aa'};font-size:${s>=10?22:18}px`;
  el.textContent = s>=10?`🔥 ${s}x`:s>=5?`⚡ ${s}x`:`✦ ${s}x`;
  document.getElementById('game-area').appendChild(el);
  setTimeout(()=>el.remove(), 700);
}
function clearGameArea() {
  document.getElementById('game-area').innerHTML = '<div id="miss-flash"></div>';
}

// ══════════════════════════════════════════════════════════
//  TRACE MODE
// ══════════════════════════════════════════════════════════
let traceFrameId = null;
let traceX = 0, traceY = 0;
let traceAngle = 0, traceSpeed = 0;
let traceTargetX = 0, traceTargetY = 0;
let traceChangeTimer = 0;
let traceMouseX = 0, traceMouseY = 0;
let traceOnFrames = 0, traceTotalFrames = 0;

const TRACE_DIFF = {
  easy:   { baseSpeed:1.4, maxSpeed:2.2, turnRate:0.018, size:80, maxDist:55, ppf:3 },
  medium: { baseSpeed:2.8, maxSpeed:4.5, turnRate:0.030, size:60, maxDist:40, ppf:5 },
  hard:   { baseSpeed:5.0, maxSpeed:8.0, turnRate:0.045, size:44, maxDist:28, ppf:8 },
};

function startTraceMode() {
  document.getElementById('reaction-overlay').style.display = 'none';
  clearGameArea();
  const ga   = document.getElementById('game-area');
  const diff = TRACE_DIFF[settings.difficulty] || TRACE_DIFF.medium;

  const rect = ga.getBoundingClientRect();
  traceX = rect.width  / 2;
  traceY = rect.height / 2;
  traceAngle = Math.random() * Math.PI * 2;
  traceSpeed = diff.baseSpeed;
  traceChangeTimer = 0;
  traceOnFrames = 0; traceTotalFrames = 0;

  pickNewTarget(ga, diff);

  const sz = diff.size;
  const circle = document.createElement('div');
  circle.id = 'trace-circle';
  circle.style.cssText = `
    position:absolute; width:${sz}px; height:${sz}px; border-radius:50%;
    background:radial-gradient(circle at 35% 35%, #00ffcc, #0088aa);
    box-shadow:0 0 18px rgba(0,255,200,0.7),0 0 40px rgba(0,255,200,0.3);
    border:2px solid rgba(0,255,200,0.9);
    transform:translate(-50%,-50%); pointer-events:none;
  `;
  ga.appendChild(circle);

  const ring = document.createElement('div');
  ring.id = 'trace-ring';
  ring.style.cssText = `
    position:absolute; width:${sz+28}px; height:${sz+28}px; border-radius:50%;
    border:2px dashed rgba(0,255,200,0.3);
    transform:translate(-50%,-50%); pointer-events:none;
  `;
  ga.appendChild(ring);

  const status = document.createElement('div');
  status.id = 'trace-status';
  status.textContent = 'KEEP YOUR CURSOR INSIDE THE RING';
  ga.appendChild(status);

  ga.addEventListener('mousemove', onTraceMouseMove);

  gameTimer = setInterval(() => {
    timeLeft--;
    document.getElementById('timer-display').textContent = timeLeft;
    if (timeLeft <= 5) document.getElementById('timer-display').classList.add('urgent');
    if (timeLeft <= 0) endGame();
  }, 1000);

  traceFrameId = requestAnimationFrame(() => traceLoop(diff, ga));
}

function pickNewTarget(ga, diff) {
  const margin = 80;
  traceTargetX = margin + Math.random() * (ga.offsetWidth  - margin * 2);
  traceTargetY = margin + HUD_HEIGHT + Math.random() * (ga.offsetHeight - margin * 2 - HUD_HEIGHT);
  traceChangeTimer = 90 + Math.floor(Math.random() * 110);
}

function onTraceMouseMove(e) {
  const ga   = document.getElementById('game-area');
  const rect = ga.getBoundingClientRect();
  traceMouseX = e.clientX - rect.left;
  traceMouseY = e.clientY - rect.top;
}

function traceLoop(diff, ga) {
  if (!isGameRunning) return;

  const angleToTarget = Math.atan2(traceTargetY - traceY, traceTargetX - traceX);
  let da = angleToTarget - traceAngle;
  while (da >  Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  traceAngle += da * diff.turnRate;

  if (traceSpeed < diff.maxSpeed) traceSpeed += 0.006;

  traceX += Math.cos(traceAngle) * traceSpeed;
  traceY += Math.sin(traceAngle) * traceSpeed;

  const sz = diff.size / 2;
  const W = ga.offsetWidth, H = ga.offsetHeight;
  if (traceX < sz)   { traceX = sz;   traceAngle = Math.PI - traceAngle + (Math.random()-0.5)*0.4; }
  if (traceX > W-sz) { traceX = W-sz; traceAngle = Math.PI - traceAngle + (Math.random()-0.5)*0.4; }
  if (traceY < HUD_HEIGHT+sz) { traceY = HUD_HEIGHT+sz; traceAngle = -traceAngle + (Math.random()-0.5)*0.4; }
  if (traceY > H-sz) { traceY = H-sz; traceAngle = -traceAngle + (Math.random()-0.5)*0.4; }

  traceChangeTimer--;
  if (traceChangeTimer <= 0) pickNewTarget(ga, diff);

  const circle = document.getElementById('trace-circle');
  const ring   = document.getElementById('trace-ring');
  const status = document.getElementById('trace-status');
  if (!circle) return;

  circle.style.left = traceX + 'px';
  circle.style.top  = traceY + 'px';
  ring.style.left   = traceX + 'px';
  ring.style.top    = traceY + 'px';

  const dx = traceMouseX - traceX;
  const dy = traceMouseY - traceY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  traceTotalFrames++;

  if (dist <= diff.maxDist) {
    const proximity = 1 - dist / diff.maxDist;
    score += Math.round(diff.ppf * proximity);
    traceOnFrames++;
    circle.style.boxShadow = `0 0 22px rgba(0,255,150,0.9),0 0 50px rgba(0,255,150,0.4)`;
    ring.style.borderColor = `rgba(0,255,150,0.7)`;
    if (status) { status.textContent = proximity > 0.7 ? '🎯 PERFECT' : '✓ ON TARGET'; status.style.color = '#00ff88'; }
  } else {
    const howFar = Math.min(1, (dist - diff.maxDist) / 100);
    circle.style.boxShadow = `0 0 14px rgba(255,80,80,${0.4+howFar*0.4}),0 0 28px rgba(255,60,60,0.2)`;
    ring.style.borderColor = `rgba(255,80,80,${0.4+howFar*0.4})`;
    if (status) { status.textContent = '✗ STAY ON TARGET'; status.style.color = '#ff4455'; }
  }

  document.getElementById('score-display').textContent = score;
  document.getElementById('acc-display').textContent =
    traceTotalFrames > 0
      ? Math.round((traceOnFrames / traceTotalFrames) * 100) + '%'
      : '—';

  traceFrameId = requestAnimationFrame(() => traceLoop(diff, ga));
}

function stopTraceMode() {
  if (traceFrameId) cancelAnimationFrame(traceFrameId);
  traceFrameId = null;
  const ga = document.getElementById('game-area');
  if (ga) {
    ga.removeEventListener('mousemove', onTraceMouseMove);
    const circle = document.getElementById('trace-circle');
    const ring   = document.getElementById('trace-ring');
    const status = document.getElementById('trace-status');
    if (circle) circle.remove();
    if (ring)   ring.remove();
    if (status) status.remove();
  }
}

// ══════════════════════════════════════════════════════════
//  CROSSHAIR SYSTEM
// ══════════════════════════════════════════════════════════
let _xhairEl = null;

const XHAIRS = {
  classic: () => `
    <div style="position:absolute;width:16px;height:2px;background:#fff;opacity:.9;top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:2px;height:16px;background:#fff;opacity:.9;top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:#00f5ff;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 5px #00f5ff"></div>`,
  dot: () => `
    <div style="position:absolute;width:6px;height:6px;border-radius:50%;background:#00f5ff;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 8px #00f5ff,0 0 16px #00f5ff55"></div>`,
  circle: () => `
    <div style="position:absolute;width:20px;height:20px;border:1.5px solid rgba(255,255,255,.85);border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:#00f5ff;top:50%;left:50%;transform:translate(-50%,-50%)"></div>`,
  gap: () => `
    <div style="position:absolute;width:5px;height:2px;background:#fff;top:50%;left:50%;transform:translate(-50%,-50%) translateX(-8px)"></div>
    <div style="position:absolute;width:5px;height:2px;background:#fff;top:50%;left:50%;transform:translate(-50%,-50%) translateX(8px)"></div>
    <div style="position:absolute;width:2px;height:5px;background:#fff;top:50%;left:50%;transform:translate(-50%,-50%) translateY(-8px)"></div>
    <div style="position:absolute;width:2px;height:5px;background:#fff;top:50%;left:50%;transform:translate(-50%,-50%) translateY(8px)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:#00f5ff;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 5px #00f5ff"></div>`,
  cross: () => `
    <div style="position:absolute;width:22px;height:2px;background:rgba(255,255,255,.8);top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:2px;height:22px;background:rgba(255,255,255,.8);top:50%;left:50%;transform:translate(-50%,-50%)"></div>`,
  t: () => `
    <div style="position:absolute;width:18px;height:2px;background:#fff;top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:2px;height:9px;background:#fff;top:50%;left:50%;transform:translate(-50%,-50%) translateY(5px)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:#ff6b35;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 5px #ff6b35"></div>`,
};

function initCrosshair() {
  const old = document.getElementById('custom-crosshair');
  if (old) old.remove();
  _xhairEl = document.createElement('div');
  _xhairEl.id = 'custom-crosshair';
  document.body.appendChild(_xhairEl);
  document.addEventListener('mousemove', e => {
    if (_xhairEl) { _xhairEl.style.left = e.clientX + 'px'; _xhairEl.style.top = e.clientY + 'px'; }
  }, { passive:true });
  setCrosshair(settings.crosshair);
}

function setCrosshair(style) {
  settings.crosshair = style;
  localStorage.setItem('crosshair', style);
  if (_xhairEl && XHAIRS[style]) _xhairEl.innerHTML = XHAIRS[style]();
  document.querySelectorAll('.xhair-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.xhair === style));
}

function setDifficulty(d) {
  settings.difficulty = d;
  localStorage.setItem('traceDifficulty', d);
  document.querySelectorAll('.diff-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.diff === d));
}

// ── INIT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Hide system cursor everywhere (mobile will override via CSS)
  const styleTag = document.createElement('style');
  styleTag.textContent = 'html,body,*{ cursor:none !important; }';
  document.head.appendChild(styleTag);

  initCrosshair();
  setDifficulty(settings.difficulty);
  document.querySelectorAll('.xhair-btn').forEach(btn => {
    if (btn.dataset.xhair === settings.crosshair) btn.classList.add('active');
  });

  const ga = document.getElementById('game-area');
  if (ga) {
    ga.addEventListener('mousedown', e => {
      if (!isGameRunning || selectedMode === 'trace') return;
      missClick(e);
    });
  }

  // AUTO-LOGIN: attempt to restore session
  const loggedIn = await tryAutoLogin();
  if (!loggedIn) {
    showScreen('auth-screen');
  }
});