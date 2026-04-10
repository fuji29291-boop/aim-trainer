// ═══════════════════════════════════════════════════════════
//  AIMO — COMPLETE SCRIPT
//  Bugs fixed vs previous version:
//  1. MAX_SCORE raised to match rank thresholds (was 15k, ranks go to 80k)
//  2. Tracking hitbox now uses live element position, not stale spawn coords
//  3. streak reset in startGame (was missing in inline version)
//  4. reactionMax unified to 10 (was split between 5 and 10)
//  5. fetchModeRank now queries profiles table (was scores — gave duplicates)
//  6. Leaderboard queries profiles — one row per player, deduplicated at DB level
//  7. stopTraceMode called on endGame properly in all paths
//  8. Double-endGame guard (isGameRunning check at top)
//  9. Tracking targets can't stack at border (clamped before bounce)
//  10. Anti-cheat session time reduced to 24s (30s game - 1s buffer)
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://wncodurkmacfkubnhyhi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_egPhfy4nWgh5Ci0_RGnMhQ_1rJ8J-_k';

// ═══════════════════════════════════════════════════════════
//  RANKS — thresholds match realistic 30s game scores
// ═══════════════════════════════════════════════════════════
const RANKS = [
  { name:'IRON',     icon:'🩶', min:0      },
  { name:'BRONZE',   icon:'🥉', min:1500   },
  { name:'SILVER',   icon:'🥈', min:4000   },
  { name:'GOLD',     icon:'🥇', min:8000   },
  { name:'PLATINUM', icon:'💎', min:12500  },
  { name:'DIAMOND',  icon:'💠', min:16000  },
  { name:'MASTER',   icon:'🔮', min:20000  },
  { name:'IMMORTAL', icon:'👑', min:24000  },
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

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════
const RANKED_MODES   = ['static','flick','tracking','switching','reaction','switchtrack'];
const HUD_HEIGHT     = 58;

// Anti-cheat: these are generous but physically impossible to exceed
// Static: ~1 target/0.9s * 30s = 33 targets * 300pts max = ~10000
// Flick:  1.5x multiplier so ~15000
// Reaction: 10 rounds * 2500 max = 25000
const MAX_SCORE_PER_MODE = {
  static: 14000, flick: 19000, tracking: 16000, switching: 16000, reaction: 26000, switchtrack: 19000
};
const MAX_HITS       = 200;
const MIN_MS_PER_HIT = 100; // human physiological limit ~80ms, give margin

// ═══════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════
const settings = {
  sound: true, crosshair: 'classic', xhairColor: '#00f5ff',
  difficulty: 'medium', theme: 'cyan'
};

// Fixed gameplay constants — not exposed to users to prevent score manipulation
const FIXED = { size: 52, spawn: 900 };
function updateSetting(key, val) {
  settings[key] = Number(val);
  const el = document.getElementById(key + '-val');
  if (el) el.textContent = val;
}
function toggleSettings() {
  const body  = document.getElementById('settings-body');
  const arrow = document.getElementById('settings-arrow');
  const open  = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (arrow) arrow.textContent = open ? '▲' : '▼';
}
function toggleSound() {
  settings.sound = !settings.sound;
  const btn = document.getElementById('sound-toggle');
  if (btn) { btn.textContent = settings.sound ? 'ON' : 'OFF'; btn.classList.toggle('off', !settings.sound); }
}
function setTheme(t) {
  settings.theme = t;
  [...document.body.classList].forEach(c => {
    if (c.startsWith('theme-')) document.body.classList.remove(c);
  });
  if (t !== 'cyan') document.body.classList.add('theme-' + t);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
}

// ═══════════════════════════════════════════════════════════
//  SOUND ENGINE (Web Audio API — no files needed)
// ═══════════════════════════════════════════════════════════
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function _tone(freq, endFreq, type, gainStart, gainEnd, duration) {
  if (!settings.sound) return;
  try {
    const ctx = getAudio();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
    g.gain.setValueAtTime(gainStart, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    o.start(); o.stop(ctx.currentTime + duration);
  } catch(e) {}
}
function playHit()           { _tone(900, 450, 'sine',     0.25, 0.001, 0.09); }
function playPriorityHit()   { _tone(1200, 600, 'sine',    0.3,  0.001, 0.12); }
function playMiss()          { _tone(200, 150, 'sawtooth', 0.12, 0.001, 0.08); }
function playStreak(n)       { _tone(400 + n*80, 800, 'sine', 0.2, 0.001, 0.15); }
function playReaction(ms)    { _tone(ms<200?1400:ms<300?1000:700, null, 'sine', 0.28, 0.001, 0.14); }
function playCountdown()     { _tone(440, null, 'square', 0.15, 0.001, 0.06); }

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let currentUser    = null;
let currentProfile = null;
let selectedMode     = 'static';
let selectedDuration = 30;

let score = 0, hits = 0, misses = 0, timeLeft = 30;
let streak = 0, bestStreak = 0;
let gameTimer = null, spawnTimer = null, isGameRunning = false;
let lastHitTime = 0, sessionStartTime = 0;
let hitTimestamps = [], reactionTimes = [];
let reactionState = 'idle', reactionTimeout = null;
let reactionRound = 0;
const reactionMax = 10;
let trackingFrameId    = null;
let switchTrackFrameId = null;
let traceFrameId     = null;
let currentLbTab     = 'static';

// Trace state
let traceX=0, traceY=0, traceAngle=0, traceSpeed=0;
let traceTargetX=0, traceTargetY=0, traceChangeTimer=0;
let traceMouseX=0, traceMouseY=0;
let traceOnFrames=0, traceTotalFrames=0;

const TRACE_DIFF = {
  easy:   { baseSpeed:1.4, maxSpeed:2.2, turnRate:0.018, size:80, maxDist:55, ppf:2  },
  medium: { baseSpeed:2.8, maxSpeed:4.5, turnRate:0.030, size:60, maxDist:40, ppf:4  },
  hard:   { baseSpeed:5.0, maxSpeed:8.0, turnRate:0.045, size:44, maxDist:28, ppf:7  },
};

// Avatars
const AVATARS = ['🎯','⚡','👾','🔥','💀','🦅','🐉','🦊','🤖','👻','🦁','🐺','🧠','👑','💎','🔮','🌀','⚔️','🛸','🎮'];

// ═══════════════════════════════════════════════════════════
//  SUPABASE
// ═══════════════════════════════════════════════════════════
async function supabase(path, opts = {}, token = null) {
  try {
    const res = await fetch(SUPABASE_URL + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token || currentUser?.access_token || SUPABASE_KEY}`
      }
    });
    const text = await res.text();
    try { return { ok: res.ok, data: JSON.parse(text) }; }
    catch { return { ok: res.ok, data: text }; }
  } catch(e) {
    return { ok: false, data: { message: e.message } };
  }
}

// ═══════════════════════════════════════════════════════════
//  RANK HELPERS
// ═══════════════════════════════════════════════════════════
async function fetchGlobalRank(score) {
  if (!score || score <= 0) return null;
  try {
    const { ok, data } = await supabase(`/rest/v1/profiles?best_score=gt.${score}&select=id&limit=2000`);
    if (ok && Array.isArray(data)) return data.length + 1;
  } catch(e) {}
  return null;
}

// FIX: query profiles.best_{mode} not scores table (no duplicates)
async function fetchModeRank(mode, userScore) {
  if (!userScore || userScore <= 0) return null;
  const col = 'best_' + mode;
  try {
    const { ok, data } = await supabase(`/rest/v1/profiles?${col}=gt.${userScore}&select=id&limit=2000`);
    if (ok && Array.isArray(data)) return data.length + 1;
  } catch(e) {}
  return null;
}

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════
async function register() {
  const username = document.getElementById('reg-username').value.trim().toUpperCase();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('register-error');
  const btn      = document.querySelector('#tab-register .btn-primary');
  errEl.textContent = '';
  btn.querySelector('span').textContent = 'CREATING...';
  btn.disabled = true;
  try {
    if (!username || username.length < 3) throw new Error('Username must be at least 3 characters.');
    if (!/^[A-Z0-9_]+$/.test(username))  throw new Error('Letters, numbers, underscores only.');
    if (!email.includes('@'))             throw new Error('Enter a valid email.');
    if (password.length < 6)             throw new Error('Password must be at least 6 characters.');

    // Check username taken
    const check = await supabase(`/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`, {}, SUPABASE_KEY);
    if (check.ok && Array.isArray(check.data) && check.data.length > 0)
      throw new Error('Username already taken. Choose another.');

    // Create auth user
    const auth = await supabase('/auth/v1/signup', { method:'POST', body:JSON.stringify({ email, password }) }, SUPABASE_KEY);
    if (!auth.ok || !auth.data?.user?.id)
      throw new Error(auth.data?.msg || auth.data?.error_description || 'Registration failed.');

    const uid = auth.data.user.id, token = auth.data.access_token;

    const profData = {
      id:uid, username, best_score:0, total_hits:0, games_played:0, avatar:'🎯',
      best_static:0, best_flick:0, best_tracking:0, best_switching:0, best_reaction:0, best_switchtrack:0
    };
    const profRes = await supabase('/rest/v1/profiles', { method:'POST', body:JSON.stringify(profData) }, token);
    if (!profRes.ok) throw new Error('Account created but profile save failed. Try logging in.');

    currentUser    = { id:uid, access_token:token, email };
    currentProfile = profData;
    await enterMenu();
  } catch(e) {
    errEl.textContent = e.message;
  } finally {
    btn.querySelector('span').textContent = 'CREATE ACCOUNT';
    btn.disabled = false;
  }
}

async function login() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.querySelector('#tab-login .btn-primary');
  errEl.textContent = '';
  btn.querySelector('span').textContent = 'LOGGING IN...';
  btn.disabled = true;
  try {
    if (!email.includes('@')) throw new Error('Enter a valid email.');
    if (!password)            throw new Error('Enter your password.');

    const auth = await supabase('/auth/v1/token?grant_type=password', {
      method:'POST', body:JSON.stringify({ email, password })
    }, SUPABASE_KEY);
    if (!auth.ok || !auth.data?.access_token)
      throw new Error(auth.data?.error_description || auth.data?.msg || 'Invalid email or password.');

    currentUser = { id:auth.data.user.id, access_token:auth.data.access_token, email };

    const prof = await supabase(`/rest/v1/profiles?id=eq.${currentUser.id}&select=*`, {}, auth.data.access_token);
    if (!prof.ok || !prof.data?.length) throw new Error('Profile not found. Please re-register.');

    currentProfile = prof.data[0];

    // Back-fill missing best_* columns for old accounts (including new modes)
    for (const m of RANKED_MODES) {
      if (currentProfile['best_' + m] === undefined) currentProfile['best_' + m] = 0;
    }
    if (!currentProfile.avatar) currentProfile.avatar = '🎯';

    await enterMenu();
  } catch(e) {
    errEl.textContent = e.message;
  } finally {
    btn.querySelector('span').textContent = 'LOGIN';
    btn.disabled = false;
  }
}

function logout() {
  currentUser = null; currentProfile = null;
  showScreen('auth-screen');
}

// ── GUEST MODE ──────────────────────────────────────────────
function loginAsGuest() {
  currentUser = null; // no account — scores won't submit
  currentProfile = {
    username: 'GUEST',
    best_score: 0, total_hits: 0, games_played: 0,
    avatar: '👾', is_guest: true,
    best_static:0, best_flick:0, best_tracking:0,
    best_switching:0, best_reaction:0, best_switchtrack:0
  };
  enterMenuGuest();
}

async function enterMenuGuest() {
  const rank = getRank(0);
  const prog = getRankProgress(0);
  _setEl('badge-username',  'GUEST');
  _setEl('badge-rank-icon', rank.icon);
  _setEl('badge-rank-name', rank.name);
  _setEl('badge-best',      'Guest Mode');
  _setEl('badge-avatar',    '👾');
  _setEl('badge-global-rank', '');
  _setEl('badge-rank-next', 'Create account to rank up');
  const fillEl = document.getElementById('badge-rank-fill');
  if (fillEl) fillEl.style.width = '0%';
  // Add guest tag to badge username
  const unEl = document.getElementById('badge-username');
  if (unEl && !unEl.querySelector('.badge-guest-tag')) {
    const tag = document.createElement('span');
    tag.className = 'badge-guest-tag';
    tag.textContent = 'GUEST';
    unEl.appendChild(tag);
  }
  showScreen('menu-screen');
}

function logoutOrGuest() {
  currentUser = null; currentProfile = null;
  showScreen('auth-screen');
}

async function enterMenu() {
  const rank  = getRank(currentProfile.best_score);
  const prog  = getRankProgress(currentProfile.best_score);

  _setEl('badge-username',   currentProfile.username);
  _setEl('badge-rank-icon',  rank.icon);
  _setEl('badge-rank-name',  rank.name);
  _setEl('badge-best',       'Best: ' + (currentProfile.best_score||0).toLocaleString());
  _setEl('badge-avatar',     currentProfile.avatar || '🎯');
  _setEl('badge-rank-next',  prog.next ? prog.pointsNeeded.toLocaleString() + ' pts → ' + prog.next.name : '✦ MAX RANK');
  const fillEl = document.getElementById('badge-rank-fill');
  if (fillEl) fillEl.style.width = prog.pct + '%';

  // Fetch global rank async (don't block menu)
  fetchGlobalRank(currentProfile.best_score).then(r => {
    _setEl('badge-global-rank', r ? '🌍 #' + r : '');
  });

  showScreen('menu-screen');
}

// ═══════════════════════════════════════════════════════════
//  PROFILE SCREEN
// ═══════════════════════════════════════════════════════════
async function showProfile() {
  if (currentProfile?.is_guest) {
    alert('Create a free account to view your profile and save scores to the leaderboard!');
    return;
  }
  showScreen('profile-screen');
  const p    = currentProfile;
  const rank = getRank(p.best_score);
  const prog = getRankProgress(p.best_score);

  _setEl('prof-rank-icon',       rank.icon);
  _setEl('prof-username',        p.username);
  _setEl('prof-rank-name',       rank.name);
  _setEl('prof-games',           (p.games_played||0).toLocaleString());
  _setEl('prof-total-hits',      (p.total_hits||0).toLocaleString());
  _setEl('prof-best',            (p.best_score||0).toLocaleString());
  _setEl('prof-avatar',          p.avatar||'🎯');

  // Progress bar
  const fillEl = document.getElementById('prof-progress-fill');
  if (fillEl) fillEl.style.width = prog.pct + '%';
  _setEl('prof-cur-rank',       rank.icon + ' ' + rank.name);
  _setEl('prof-next-rank',      prog.next ? prog.next.icon + ' ' + prog.next.name : '✦ MAX');
  _setEl('prof-progress-label', prog.next ? `${(p.best_score||0).toLocaleString()} / ${prog.next.min.toLocaleString()}` : 'MAX RANK');
  _setEl('prof-progress-sub',   prog.next ? `${prog.pct}% — ${prog.pointsNeeded.toLocaleString()} pts to ${prog.next.name}` : 'You have reached the highest rank!');

  _setEl('prof-global', 'LOADING...');
  fetchGlobalRank(p.best_score).then(r => {
    _setEl('prof-global', r ? '🌍 GLOBAL RANK #' + r : '🌍 GLOBAL RANK —');
  });

  // Per-mode bests + rank
  for (const mode of RANKED_MODES) {
    const ms = p['best_' + mode] || 0;
    _setEl('prof-best-' + mode, ms > 0 ? ms.toLocaleString() : '—');
    _setEl('prof-rank-' + mode, '...');
    if (ms > 0) {
      fetchModeRank(mode, ms).then(r => {
        _setEl('prof-rank-' + mode, r ? '#' + r : '—');
      });
    } else {
      _setEl('prof-rank-' + mode, '—');
    }
  }

  // Build avatar picker
  buildAvatarPicker();
  // Score history graph
  buildHistTabs();
  drawHistory();
  initHistTooltip();
}

function buildAvatarPicker() {
  const grid = document.getElementById('avatar-grid');
  if (!grid) return;
  grid.innerHTML = '';
  AVATARS.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'avatar-opt' + (a === (currentProfile.avatar||'🎯') ? ' active' : '');
    btn.textContent = a;
    btn.onclick = () => setAvatar(a);
    grid.appendChild(btn);
  });
}

function toggleAvatarPicker() {
  const picker = document.getElementById('avatar-picker');
  if (picker) picker.classList.toggle('open');
}

async function setAvatar(emoji) {
  if (!currentUser) return;
  currentProfile.avatar = emoji;
  _setEl('prof-avatar', emoji);
  _setEl('badge-avatar', emoji);
  document.querySelectorAll('.avatar-opt').forEach(b => b.classList.toggle('active', b.textContent === emoji));
  // Save to DB
  await supabase(`/rest/v1/profiles?id=eq.${currentUser.id}`, {
    method:'PATCH', body:JSON.stringify({ avatar: emoji })
  });
  const picker = document.getElementById('avatar-picker');
  if (picker) picker.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════
//  SCREEN HELPERS
// ═══════════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function switchTab(tab) {
  document.getElementById('tab-login').style.display    = tab === 'login'    ? 'flex' : 'none';
  document.getElementById('tab-register').style.display = tab === 'register' ? 'flex' : 'none';
  document.querySelectorAll('.auth-tab').forEach((el, i) =>
    el.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='register')));
}
function selectMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-card').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('mode-' + mode);
  if (el) el.classList.add('active');
}
function setDuration(d) {
  selectedDuration = d;
  document.querySelectorAll('.dur-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.dur) === d));
}
function _setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ═══════════════════════════════════════════════════════════
//  GAME START
// ═══════════════════════════════════════════════════════════
function startGame() {
  if (!currentProfile) return showScreen('auth-screen');

  // Full reset
  score = 0; hits = 0; misses = 0; timeLeft = selectedDuration;
  streak = 0; bestStreak = 0; lastHitTime = 0;
  hitTimestamps = []; reactionTimes = [];
  sessionStartTime = Date.now();
  isGameRunning = true;

  stopTracking(); stopTraceMode();
  clearGameArea(); updateHUD();

  showScreen('game-screen');
  document.getElementById('timer-display').classList.remove('urgent');
  _setEl('mode-label-hud', selectedMode.toUpperCase());
  const streakEl = document.getElementById('hud-streak');
  if (streakEl) streakEl.style.display = 'none';

  const reactEl = document.getElementById('reaction-overlay');
  if (reactEl) reactEl.style.display = 'none';

  if (selectedMode === 'reaction')    { startReactionMode();   return; }
  if (selectedMode === 'tracking')    { startTracking();       return; } // circle-follow mode
  if (selectedMode === 'switchtrack') { startSwitchTracking(); return; }

  // Standard timer for target-clicking modes
  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 5) { if (td) td.classList.add('urgent'); playCountdown(); }
    if (timeLeft <= 0) endGame();
  }, 1000);

  // Spawn intervals — fixed values, not user-adjustable
  const intervals = { static:900, flick:1200, switching:650 };
  const interval  = intervals[selectedMode] || 900;
  spawnTimer = setInterval(spawnTarget, interval);
  spawnTarget();

  if (selectedMode === 'switching') {
    setTimeout(spawnTarget, 200);
    setTimeout(spawnTarget, 450);
  }
}

// ═══════════════════════════════════════════════════════════
//  TRACKING MODE MOVEMENT
// ═══════════════════════════════════════════════════════════
// Tracking mode = one moving circle you follow with your mouse (formerly Trace)
function startTracking() {
  const ov = document.getElementById('reaction-overlay');
  if (ov) ov.style.display = 'none';
  clearGameArea();

  const ga   = document.getElementById('game-area');
  if (!ga) return;
  const diff = TRACE_DIFF[settings.difficulty] || TRACE_DIFF.medium;
  const rect = ga.getBoundingClientRect();

  // Reset all trace state
  traceX = rect.width  / 2;
  traceY = rect.height / 2;
  traceMouseX = rect.width  / 2;
  traceMouseY = rect.height / 2;
  traceAngle = Math.random() * Math.PI * 2;
  traceSpeed = diff.baseSpeed;
  traceOnFrames = 0; traceTotalFrames = 0; traceChangeTimer = 0;
  _trkVx = 0; _trkVy = 0; _trkJitterTimer = 0; _trkFakeTimer = 0; _trkFaking = false;

  pickNewTrackingTarget(ga, diff);

  const sz = diff.size;

  // Main circle
  const circle = document.createElement('div');
  circle.id = 'track-circle';
  circle.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;` +
    `background:radial-gradient(circle at 35% 35%,#00ffcc,#0088aa);` +
    `box-shadow:0 0 18px rgba(0,255,200,0.7),0 0 40px rgba(0,255,200,0.3);` +
    `border:2px solid rgba(0,255,200,0.9);` +
    `transform:translate(-50%,-50%);pointer-events:none;transition:box-shadow 0.1s;`;
  ga.appendChild(circle);

  // Accuracy ring — follow cursor in this to score
  const ring = document.createElement('div');
  ring.id = 'track-ring';
  ring.style.cssText = `position:absolute;width:${sz+30}px;height:${sz+30}px;border-radius:50%;` +
    `border:2px dashed rgba(0,255,200,0.35);` +
    `transform:translate(-50%,-50%);pointer-events:none;transition:border-color 0.1s;`;
  ga.appendChild(ring);

  // Status label
  const status = document.createElement('div');
  status.id = 'track-status';
  status.textContent = 'KEEP YOUR CURSOR INSIDE THE RING';
  ga.appendChild(status);

  ga.addEventListener('mousemove', onTrackingMouseMove);

  // Standard game timer
  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 5) { if (td) td.classList.add('urgent'); playCountdown(); }
    if (timeLeft <= 0) endGame();
  }, 1000);

  trackingFrameId = requestAnimationFrame(() => trackingCircleLoop(diff, ga));
}

// Extra state for human-like movement
let _trkVx = 0, _trkVy = 0;          // velocity components
let _trkJitterTimer = 0;              // frames until next jitter burst
let _trkFakeTimer = 0;               // frames until fake direction switch ends
let _trkFaking = false;               // currently doing a fake
let _trkFakeAngle = 0;               // saved real angle during fake

function pickNewTrackingTarget(ga, diff) {
  const margin = 80;
  traceTargetX = margin + Math.random() * (ga.offsetWidth  - margin * 2);
  traceTargetY = margin + HUD_HEIGHT + Math.random() * (ga.offsetHeight - margin * 2 - HUD_HEIGHT);
  // Vary how long before switching target — shorter on hard
  const base = diff === TRACE_DIFF.hard ? 55 : diff === TRACE_DIFF.easy ? 130 : 85;
  traceChangeTimer = base + Math.floor(Math.random() * 70);
}

function onTrackingMouseMove(e) {
  const ga = document.getElementById('game-area');
  if (!ga) return;
  const rect = ga.getBoundingClientRect();
  traceMouseX = e.clientX - rect.left;
  traceMouseY = e.clientY - rect.top;
}

function trackingCircleLoop(diff, ga) {
  if (!isGameRunning) return;

  const sz = diff.size / 2;
  const W  = ga.offsetWidth, H = ga.offsetHeight;

  // ── Acceleration toward steering target ──────────────────
  const angleToTarget = Math.atan2(traceTargetY - traceY, traceTargetX - traceX);
  let da = angleToTarget - traceAngle;
  while (da >  Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;

  // Fake direction switch: briefly steer the opposite way
  if (!_trkFaking && Math.random() < (diff === TRACE_DIFF.hard ? 0.004 : 0.002)) {
    _trkFaking    = true;
    _trkFakeAngle = traceAngle;
    _trkFakeTimer = 18 + Math.floor(Math.random() * 22); // ~0.3–0.6s
  }
  if (_trkFaking) {
    traceAngle -= da * diff.turnRate * 1.4; // steer opposite
    _trkFakeTimer--;
    if (_trkFakeTimer <= 0) { _trkFaking = false; }
  } else {
    traceAngle += da * diff.turnRate;
  }

  // ── Smooth acceleration / deceleration ────────────────────
  const distToTarget = Math.hypot(traceTargetX - traceX, traceTargetY - traceY);
  const targetSpeed  = distToTarget < 80
    ? diff.baseSpeed                       // decelerate near target
    : diff.maxSpeed;
  const accel = distToTarget < 80 ? 0.04 : 0.012;
  traceSpeed += (targetSpeed - traceSpeed) * accel;
  traceSpeed  = Math.max(diff.baseSpeed * 0.4, Math.min(diff.maxSpeed * 1.15, traceSpeed));

  // ── Random jitter bursts (human micro-corrections) ────────
  _trkJitterTimer--;
  let jx = 0, jy = 0;
  if (_trkJitterTimer <= 0) {
    const jStr = diff === TRACE_DIFF.hard ? 1.4 : diff === TRACE_DIFF.easy ? 0.5 : 0.9;
    jx = (Math.random() - 0.5) * jStr;
    jy = (Math.random() - 0.5) * jStr;
    _trkJitterTimer = 8 + Math.floor(Math.random() * 20);
  }

  // ── Persistent velocity with momentum ────────────────────
  const vxTarget = Math.cos(traceAngle) * traceSpeed + jx;
  const vyTarget = Math.sin(traceAngle) * traceSpeed + jy;
  _trkVx += (vxTarget - _trkVx) * 0.18;  // smooth velocity transition
  _trkVy += (vyTarget - _trkVy) * 0.18;

  traceX += _trkVx;
  traceY += _trkVy;

  // ── Wall bounce — reflect velocity, add randomness ────────
  if (traceX < sz)            { traceX = sz;            _trkVx = Math.abs(_trkVx) * (0.7+Math.random()*0.3);  traceAngle = Math.PI - traceAngle + (Math.random()-0.5)*0.5; }
  if (traceX > W - sz)        { traceX = W - sz;        _trkVx = -Math.abs(_trkVx) * (0.7+Math.random()*0.3); traceAngle = Math.PI - traceAngle + (Math.random()-0.5)*0.5; }
  if (traceY < HUD_HEIGHT+sz) { traceY = HUD_HEIGHT+sz; _trkVy = Math.abs(_trkVy) * (0.7+Math.random()*0.3);  traceAngle = -traceAngle + (Math.random()-0.5)*0.5; }
  if (traceY > H - sz)        { traceY = H - sz;        _trkVy = -Math.abs(_trkVy) * (0.7+Math.random()*0.3); traceAngle = -traceAngle + (Math.random()-0.5)*0.5; }

  // ── Switch steering target periodically ──────────────────
  traceChangeTimer--;
  if (traceChangeTimer <= 0) pickNewTrackingTarget(ga, diff);

  // Move DOM elements
  const circle = document.getElementById('track-circle');
  const ring   = document.getElementById('track-ring');
  const status = document.getElementById('track-status');
  if (!circle) return;

  circle.style.left = traceX + 'px';
  circle.style.top  = traceY + 'px';
  ring.style.left   = traceX + 'px';
  ring.style.top    = traceY + 'px';

  // Score by cursor proximity to circle center
  const dx   = traceMouseX - traceX;
  const dy   = traceMouseY - traceY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  traceTotalFrames++;

  if (dist <= diff.maxDist) {
    const prox = 1 - dist / diff.maxDist;
    score += Math.round(diff.ppf * prox);
    traceOnFrames++;
    circle.style.boxShadow = '0 0 24px rgba(0,255,150,0.95),0 0 55px rgba(0,255,150,0.45)';
    ring.style.borderColor  = 'rgba(0,255,150,0.75)';
    if (status) {
      status.textContent  = prox > 0.7 ? '🎯 PERFECT' : '✓ ON TARGET';
      status.style.color  = '#00ff88';
    }
  } else {
    const fade = Math.min(1, (dist - diff.maxDist) / 80);
    circle.style.boxShadow = `0 0 14px rgba(255,80,80,${0.45 + fade*0.4})`;
    ring.style.borderColor  = `rgba(255,80,80,${0.45 + fade*0.4})`;
    if (status) {
      status.textContent = '✗ STAY ON TARGET';
      status.style.color = '#ff4455';
    }
  }

  // Update HUD live
  const sd = document.getElementById('score-display');
  const ad = document.getElementById('acc-display');
  if (sd) sd.textContent = score.toLocaleString();
  if (ad) ad.textContent = traceTotalFrames > 0
    ? Math.round((traceOnFrames / traceTotalFrames) * 100) + '%' : '—';

  trackingFrameId = requestAnimationFrame(() => trackingCircleLoop(diff, ga));
}

function stopTracking() {
  if (trackingFrameId) { cancelAnimationFrame(trackingFrameId); trackingFrameId = null; }
  const ga = document.getElementById('game-area');
  if (ga) ga.removeEventListener('mousemove', onTrackingMouseMove);
}
function stopSwitchTracking() {
  if (switchTrackFrameId) { cancelAnimationFrame(switchTrackFrameId); switchTrackFrameId = null; }
}

// ═══════════════════════════════════════════════════════════
//  REACTION MODE
// ═══════════════════════════════════════════════════════════
function startReactionMode() {
  reactionRound = 0; reactionTimes = [];
  const ov = document.getElementById('reaction-overlay');
  if (ov) { ov.style.display = 'flex'; }
  _setEl('reaction-scores', '');
  _setEl('reaction-time', '');

  nextReaction();

  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 0) endGame();
  }, 1000);
}

function nextReaction() {
  if (!isGameRunning) return;
  if (reactionRound >= reactionMax) { endGame(); return; }

  reactionState = 'waiting';
  const msg = document.getElementById('reaction-msg');
  if (msg) { msg.textContent = 'WAIT FOR GREEN...'; msg.className = 'reaction-msg'; }
  _setEl('reaction-time', '');
  clearGameArea();

  const delay = 800 + Math.random() * 2200; // 0.8–3s, unpredictable
  reactionTimeout = setTimeout(() => {
    if (!isGameRunning) return;
    const ga = document.getElementById('game-area');
    if (!ga) return;
    const sz = FIXED.size;
    const x  = Math.random() * (ga.offsetWidth  - sz*2) + sz;
    const y  = Math.random() * (ga.offsetHeight - sz*2 - HUD_HEIGHT) + sz + HUD_HEIGHT;

    const target = document.createElement('div');
    target.className = 'target';
    target.style.cssText = `width:${sz}px;height:${sz}px;left:${x}px;top:${y}px`;
    target.innerHTML = `<div class="target-inner" style="background:radial-gradient(circle at 35% 30%,#00ff88,#00aa55);border-color:rgba(0,255,136,0.9);box-shadow:0 0 20px rgba(0,255,100,0.7)"></div>`;
    target.addEventListener('mousedown', e => { e.stopPropagation(); handleReactionHit(); });
    ga.appendChild(target);

    if (msg) { msg.textContent = 'CLICK!'; msg.className = 'reaction-msg go'; }
    reactionState = 'go';
    lastHitTime = Date.now();
  }, delay);
}

function handleReactionHit() {
  if (!isGameRunning || reactionState !== 'go') return;
  const ms = Date.now() - lastHitTime;
  reactionTimes.push(ms);
  reactionState = 'idle'; reactionRound++;
  const pts = Math.max(200, Math.round(2500 - ms * 4));
  hits++; score += pts; updateHUD(); playReaction(ms); clearGameArea();

  _setEl('reaction-time', ms + 'ms');
  addReactionPill(ms + 'ms');

  const msg = document.getElementById('reaction-msg');
  if (msg) {
    msg.textContent = ms<150?'INHUMAN!':ms<200?'GODLIKE!':ms<280?'FAST!':ms<400?'GOOD':ms<600?'OKAY':'SLOW...';
    msg.className = 'reaction-msg go';
  }
  setTimeout(nextReaction, 1200);
}

function addReactionPill(text) {
  const el = document.createElement('div');
  el.className = 'reaction-score-pill'; el.textContent = text;
  const sc = document.getElementById('reaction-scores');
  if (sc) sc.appendChild(el);
}

// ═══════════════════════════════════════════════════════════
//  SPAWN TARGET
// ═══════════════════════════════════════════════════════════
function spawnTarget() {
  if (!isGameRunning || selectedMode === 'reaction' || selectedMode === 'switchtrack') return;

  // Cap tracking targets at 3 simultaneously
  if (selectedMode === 'tracking' && document.querySelectorAll('.target.tracking').length >= 3) return;

  const ga = document.getElementById('game-area');
  if (!ga) return;
  const sz = FIXED.size, margin = sz + 4;
  const x  = Math.random() * (ga.offsetWidth  - margin*2) + margin;
  const y  = Math.random() * (ga.offsetHeight - margin*2 - HUD_HEIGHT) + margin + HUD_HEIGHT;

  // Switching: rotate which target is priority
  if (selectedMode === 'switching') {
    document.querySelectorAll('.target.priority').forEach(t => t.classList.remove('priority'));
    const existing = document.querySelectorAll('.target.switching');
    if (existing.length > 0) {
      existing[Math.floor(Math.random() * existing.length)].classList.add('priority');
    }
  }

  const modeClass = { tracking:'tracking', switching:'switching', flick:'flick' }[selectedMode] || '';
  const target = document.createElement('div');
  target.className = ('target ' + modeClass).trim();
  target.style.cssText = `width:${sz}px;height:${sz}px;left:${x}px;top:${y}px`;

  if (selectedMode === 'tracking') {
    const spd = 2.5 + Math.random() * 2.0; // fixed speed range — not user-adjustable
    target.dataset.angle = Math.random() * Math.PI * 2;
    target.dataset.spd   = spd;
  }

  target.innerHTML = '<div class="target-inner"></div>';

  // FIX: use mousedown (not click) for faster response
  target.addEventListener('mousedown', e => {
    e.stopPropagation();
    // FIX for tracking: get LIVE position from element, not stale spawn coords
    const rect  = target.getBoundingClientRect();
    const gaRect = ga.getBoundingClientRect();
    const liveX  = rect.left - gaRect.left + rect.width / 2;
    const liveY  = rect.top  - gaRect.top  + rect.height / 2;
    hitTarget(target, liveX, liveY);
  });

  ga.appendChild(target);

  // TTLs: flick is very short, tracking never auto-removes
  const ttl = { static:2400, flick:650, tracking:99999, switching:3000 }[selectedMode] || 2400;

  // Shrink ring for flick mode (visual countdown)
  if (selectedMode === 'flick') {
    const ring = document.createElement('div');
    ring.className = 'shrink-ring';
    ring.style.cssText = `left:${x}px;top:${y}px;--ttl:${ttl}ms;--start-size:${sz*2.5}px`;
    ga.appendChild(ring);
    setTimeout(() => { if (ring.parentNode) ring.remove(); }, ttl);
  }

  if (ttl < 99999) {
    setTimeout(() => { if (target.parentNode) target.remove(); }, ttl);
  }
}

// ═══════════════════════════════════════════════════════════
//  HIT
// ═══════════════════════════════════════════════════════════
function hitTarget(el, x, y) {
  if (!isGameRunning) return;

  const now           = Date.now();
  const timeSinceLast = lastHitTime ? (now - lastHitTime) : 9999;
  hitTimestamps.push(now);
  lastHitTime = now;

  streak++;
  if (streak > bestStreak) bestStreak = streak;

  let points   = 150;
  let bonusText = null;
  const isPriority = el.classList.contains('priority');

  // Speed bonus
  if (timeSinceLast < 350)       { points += 120; bonusText = '+120 FAST!'; }
  else if (timeSinceLast < 650)  { points += 60;  bonusText = '+60 QUICK';  }

  // Mode multipliers
  if (selectedMode === 'flick')        points = Math.round(points * 1.8);
  if (selectedMode === 'tracking')     points = Math.round(points * 1.5);
  if (selectedMode === 'switchtrack' && isPriority)  { points = Math.round(points * 2.2); bonusText = '+LOCK!'; }
  if (selectedMode === 'switchtrack' && !isPriority) { points = Math.round(points * 0.5); }
  if (selectedMode === 'switching' && isPriority) { points += 200; bonusText = '+200 PRIORITY!'; }

  // Streak multiplier: every 5 hits = +10% up to +60%
  const streakMult = 1 + Math.min(0.6, Math.floor(streak / 5) * 0.1);
  points = Math.round(points * streakMult);

  hits++; score += points; updateHUD();

  if (isPriority) playPriorityHit(); else playHit();
  if (streak > 0 && streak % 5 === 0) playStreak(streak / 5);

  showScorePopup(x, y, '+' + points, false);
  if (bonusText) showScorePopup(x, y - 38, bonusText, true);
  if (streak >= 3) showStreakLabel(x, y + 38);
  showHitRing(x, y);
  el.remove();

  // Update streak HUD
  const sEl = document.getElementById('hud-streak');
  const sCount = document.getElementById('streak-count');
  if (sEl && sCount) {
    if (streak >= 3) {
      sEl.style.display = 'block';
      sCount.textContent = streak;
    } else {
      sEl.style.display = 'none';
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  MISS
// ═══════════════════════════════════════════════════════════
function missClick(e) {
  if (!isGameRunning) return;
  if (selectedMode === 'reaction') {
    if (reactionState === 'waiting') {
      clearTimeout(reactionTimeout);
      const msg = document.getElementById('reaction-msg');
      if (msg) { msg.textContent = 'TOO EARLY!'; msg.className = 'reaction-msg early'; }
      playMiss(); reactionTimes.push(999); reactionRound++;
      addReactionPill('EARLY');
      setTimeout(nextReaction, 1000);
    }
    return;
  }
  if (e.target.classList.contains('target') || e.target.classList.contains('target-inner')) return;

  misses++; streak = 0; updateHUD(); playMiss();
  const flash = document.getElementById('miss-flash');
  if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 150); }

  // Hide streak HUD on miss
  const sEl = document.getElementById('hud-streak');
  if (sEl) sEl.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  VALIDATE (anti-cheat)
// ═══════════════════════════════════════════════════════════
function validateScore() {
  const ms            = Date.now() - sessionStartTime;
  const durationScale = selectedDuration / 30;
  const maxScore      = (MAX_SCORE_PER_MODE[selectedMode] || 20000) * durationScale;
  const minMs         = (selectedDuration - 2) * 1000;

  if (selectedMode !== 'reaction' && ms < minMs) return { valid:false, reason:'Session too short' };
  if (selectedMode === 'reaction' && hits < 5)   return { valid:false, reason:'Too few reaction rounds' };
  if (score > maxScore)                          return { valid:false, reason:'Score exceeds maximum for this mode' };
  if (hits > MAX_HITS * durationScale)           return { valid:false, reason:'Hit count exceeds maximum' };

  for (let i = 1; i < hitTimestamps.length; i++) {
    if (hitTimestamps[i] - hitTimestamps[i-1] < MIN_MS_PER_HIT)
      return { valid:false, reason:'Inhuman click speed detected' };
  }

  // Bug 1 fix: reaction + switchtrack have 0 misses by design — skip accuracy check
  if (selectedMode !== 'reaction' && selectedMode !== 'switchtrack') {
    const total = hits + misses;
    if (total > 5 && hits / total > 0.999)
      return { valid:false, reason:'Suspicious accuracy' };
  }

  return { valid:true };
}

// ═══════════════════════════════════════════════════════════
//  END GAME
// ═══════════════════════════════════════════════════════════
async function endGame() {
  if (!isGameRunning) return; // FIX: guard against double-call
  isGameRunning = false;

  clearInterval(gameTimer); clearInterval(spawnTimer);
  clearTimeout(reactionTimeout);
  stopTracking(); stopTraceMode(); stopSwitchTracking(); // FIX: always clean up all
  clearGameArea();

  const ov = document.getElementById('reaction-overlay');
  if (ov) ov.style.display = 'none';

  const total    = hits + misses;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  const validR   = reactionTimes.filter(t => t < 999);
  const avgReact = validR.length > 0 ? Math.round(validR.reduce((a,b) => a+b, 0) / validR.length) : null;

  _setEl('final-score',    score.toLocaleString());
  _setEl('final-hits',     hits);
  _setEl('final-accuracy', accuracy + '%');
  _setEl('final-react',    avgReact ? avgReact + 'ms' : '—');
  _setEl('final-streak',   bestStreak);
  _setEl('final-misses',   misses);
  _setEl('results-name-display', currentProfile.username);

  const rank = getRank(score);
  _setEl('result-rank-icon', rank.icon);
  _setEl('result-rank-name', rank.name);

  const isNewBest = score > (currentProfile.best_score || 0);
  const nbEl = document.getElementById('new-best-banner');
  if (nbEl) nbEl.style.display = isNewBest ? 'block' : 'none';

  const mrEl = document.getElementById('result-mode-rank');
  if (mrEl) mrEl.style.display = 'none';

  // Rank progress bar
  const prog  = getRankProgress(score);
  const rpEl  = document.getElementById('result-rank-progress');
  if (rpEl) rpEl.style.display = 'block';
  _setEl('rrp-cur',  rank.icon + ' ' + rank.name);
  _setEl('rrp-next', prog.next ? prog.next.icon + ' ' + prog.next.name : '✦ MAX');
  _setEl('rrp-pct',  prog.pct + '%');
  _setEl('rrp-sub',  prog.next ? `${prog.pct}% — ${prog.pointsNeeded.toLocaleString()} pts to ${prog.next.name}` : 'Maximum rank achieved!');
  const rrpFill = document.getElementById('rrp-fill');
  if (rrpFill) { rrpFill.style.width = '0%'; setTimeout(() => { rrpFill.style.width = prog.pct + '%'; }, 200); }

  showScreen('results-screen');

  const statusEl = document.getElementById('submit-status');

  // Guest mode — skip all submission
  if (currentProfile?.is_guest) {
    statusEl.textContent = '👾 Guest mode — create an account to save scores';
    statusEl.className = 'submit-status';
    return;
  }

  statusEl.textContent = 'VALIDATING & SUBMITTING...'; statusEl.className = 'submit-status';

  const check = validateScore();
  if (!check.valid) {
    statusEl.textContent = '⚠ ' + check.reason;
    statusEl.className = 'submit-status error';
    return;
  }

  try {
    const ins = await supabase('/rest/v1/scores', {
      method:'POST',
      body:JSON.stringify({ user_id:currentUser.id, name:currentProfile.username, score, accuracy, hits, mode:selectedMode })
    });
    if (!ins.ok) throw new Error(JSON.stringify(ins.data));

    const newBest     = Math.max(score, currentProfile.best_score || 0);
    const modeCol     = 'best_' + selectedMode;
    const newModeBest = Math.max(score, currentProfile[modeCol] || 0);
    const newHits     = (currentProfile.total_hits  || 0) + hits;
    const newGames    = (currentProfile.games_played|| 0) + 1;

    const patch = { best_score:newBest, total_hits:newHits, games_played:newGames, [modeCol]:newModeBest };
    await supabase(`/rest/v1/profiles?id=eq.${currentUser.id}`, { method:'PATCH', body:JSON.stringify(patch) });

    currentProfile.best_score    = newBest;
    currentProfile.total_hits    = newHits;
    currentProfile.games_played  = newGames;
    currentProfile[modeCol]      = newModeBest;

    // Update menu badge live
    const rankUpd = getRank(newBest);
    const progUpd = getRankProgress(newBest);
    _setEl('badge-best',      'Best: ' + newBest.toLocaleString());
    _setEl('badge-rank-icon', rankUpd.icon);
    _setEl('badge-rank-name', rankUpd.name);
    const bfEl = document.getElementById('badge-rank-fill');
    if (bfEl) bfEl.style.width = progUpd.pct + '%';
    _setEl('badge-rank-next', progUpd.next ? progUpd.pointsNeeded.toLocaleString() + ' pts → ' + progUpd.next.name : '✦ MAX RANK');

    statusEl.textContent = '✓ SCORE SUBMITTED'; statusEl.className = 'submit-status success';
    // Save locally for the history graph
    saveToHistory(selectedMode, score, accuracy, hits, bestStreak, selectedDuration);

    // Daily challenge — save locally + push to daily_scores table
    if (_isDailyChallenge) {
      _isDailyChallenge = false;
      saveDailyRecord(score, accuracy);
      try {
        const cfg = getDailyConfig();
        await supabase('/rest/v1/daily_scores', {
          method: 'POST',
          body: JSON.stringify({
            date_key: cfg.key,
            user_id:  currentUser?.id || null,
            username: currentProfile.username,
            score, accuracy, mode: cfg.mode
          })
        });
      } catch(e) {} // non-critical — local record already saved
    }

    // Show mode rank
    const modeRank = await fetchModeRank(selectedMode, score);
    if (modeRank) {
      const mrEl = document.getElementById('result-mode-rank');
      if (mrEl) {
        mrEl.style.display = 'block';
        _setEl('result-mode-rank-text', `🎯 YOU ARE RANK #${modeRank} GLOBALLY IN ${selectedMode.toUpperCase()}`);
      }
    }

    // Update global rank badge
    const globalR = await fetchGlobalRank(newBest);
    if (globalR) _setEl('badge-global-rank', '🌍 #' + globalR);

  } catch(e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.className = 'submit-status error';
  }
}

// ═══════════════════════════════════════════════════════════
//  LEADERBOARD — queries profiles (one row per player)
// ═══════════════════════════════════════════════════════════
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
  const list       = document.getElementById('lb-list');
  const yourRankEl = document.getElementById('lb-your-rank');
  const yourRankNm = document.getElementById('lb-your-rank-num');
  list.innerHTML = '<div class="lb-loading">FETCHING SCORES...</div>';
  if (yourRankEl) yourRankEl.style.display = 'none';

  const modeCol = 'best_' + currentLbTab;

  try {
    // FIX: query profiles table directly — one row per player, deduplicated at DB level
    const { ok, data } = await supabase(
      `/rest/v1/profiles?select=username,${modeCol},games_played,avatar&${modeCol}=gt.0&order=${modeCol}.desc&limit=50`
    );

    if (!ok || !Array.isArray(data) || !data.length) {
      list.innerHTML = '<div class="lb-loading">No scores yet for this mode — be the first!</div>';
      return;
    }

    const medals = ['🥇','🥈','🥉'], rc = ['r1','r2','r3'], rowC = ['top1','top2','top3'];
    const myName = currentProfile?.username || '';

    list.innerHTML = `
      <div class="lb-header">
        <span>#</span><span>NAME</span>
        <span style="text-align:right">BEST</span>
        <span style="text-align:right">GAMES</span>
        <span style="text-align:right">RANK</span>
      </div>
      ${data.map((r, i) => {
        const isMe = r.username === myName;
        const rank = getRank(r[modeCol] || 0);
        return `<div class="lb-row ${rowC[i]||''} ${isMe?'mine':''}">
          <span class="lb-rank ${rc[i]||''}">${i<3 ? medals[i] : i+1}</span>
          <span class="lb-name ${isMe?'mine-name':''}">${escHtml(r.avatar||'🎯')} ${escHtml(r.username)}${isMe?' ◀ YOU':''}</span>
          <span class="lb-score">${(r[modeCol]||0).toLocaleString()}</span>
          <span class="lb-acc">${r.games_played||0}</span>
          <span class="lb-tier">${rank.icon} ${rank.name}</span>
        </div>`;
      }).join('')}`;

    // Show your rank
    const myPos = data.findIndex(r => r.username === myName);
    if (myPos !== -1 && yourRankEl && yourRankNm) {
      yourRankNm.textContent = '#' + (myPos + 1);
      yourRankEl.style.display = 'block';
    } else if (yourRankEl && yourRankNm) {
      const myScore = currentProfile[modeCol] || 0;
      if (myScore > 0) {
        fetchModeRank(currentLbTab, myScore).then(r => {
          if (r) { yourRankNm.textContent = '#' + r; yourRankEl.style.display = 'block'; }
        });
      }
    }
  } catch(e) {
    list.innerHTML = '<div class="lb-loading">Could not load scores. Check connection.</div>';
  }
}


// stopTraceMode stub — tracking cleanup handled by stopTracking()
function stopTraceMode() { stopTracking(); }


// ═══════════════════════════════════════════════════════════
//  CROSSHAIR
// ═══════════════════════════════════════════════════════════
let _xhairEl = null;

const XHAIRS = {
  classic: (c) => `
    <div style="position:absolute;width:18px;height:2px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:2px;height:18px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:${c};top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 5px ${c}"></div>`,
  dot: (c) => `
    <div style="position:absolute;width:6px;height:6px;border-radius:50%;background:${c};top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 8px ${c}"></div>`,
  circle: (c) => `
    <div style="position:absolute;width:22px;height:22px;border:1.5px solid ${c};border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>`,
  gap: (c) => `
    <div style="position:absolute;width:6px;height:2px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%) translateX(-9px)"></div>
    <div style="position:absolute;width:6px;height:2px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%) translateX(9px)"></div>
    <div style="position:absolute;width:2px;height:6px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%) translateY(-9px)"></div>
    <div style="position:absolute;width:2px;height:6px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%) translateY(9px)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>`,
  cross: (c) => `
    <div style="position:absolute;width:24px;height:2px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:2px;height:24px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>`,
  t: (c) => `
    <div style="position:absolute;width:20px;height:2px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div style="position:absolute;width:2px;height:10px;background:${c};top:50%;left:50%;transform:translate(-50%,-50%) translateY(6px)"></div>
    <div style="position:absolute;width:3px;height:3px;border-radius:50%;background:${c};top:50%;left:50%;transform:translate(-50%,-50%)"></div>`,
};

function initCrosshair() {
  const old = document.getElementById('custom-crosshair');
  if (old) { _xhairEl = old; }
  else {
    _xhairEl = document.createElement('div');
    _xhairEl.id = 'custom-crosshair';
    document.body.appendChild(_xhairEl);
  }
  _xhairEl.style.willChange = 'transform';
  _xhairEl.style.left = '0';
  _xhairEl.style.top  = '0';
  // No offset subtracted — div is 0×0 so its origin IS the cursor hotspot.
  // All child elements use translate(-50%,-50%) to center themselves on that point.
  document.addEventListener('mousemove', e => {
    if (_xhairEl) {
      _xhairEl.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
    }
  }, { passive: true });
  setCrosshair(settings.crosshair);
}

function setCrosshair(style) {
  settings.crosshair = style;
  if (_xhairEl && XHAIRS[style]) {
    _xhairEl.innerHTML = `<div style="position:absolute;transform:translate(-50%,-50%);pointer-events:none;">${XHAIRS[style](settings.xhairColor)}</div>`;
  }
  document.querySelectorAll('.xhair-btn').forEach(b => b.classList.toggle('active', b.dataset.xhair === style));
}

function setXhairColor(color) {
  settings.xhairColor = color;
  setCrosshair(settings.crosshair); // re-render with new color
  document.querySelectorAll('.color-btn').forEach(b => b.classList.toggle('active', b.dataset.color === color));
}

function setDifficulty(d) {
  settings.difficulty = d;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === d));
}

// ═══════════════════════════════════════════════════════════
//  VISUALS
// ═══════════════════════════════════════════════════════════
function showScorePopup(x, y, text, isBonus) {
  const el = document.createElement('div');
  el.className = 'score-popup' + (isBonus ? ' bonus' : '');
  el.style.cssText = `left:${x}px;top:${y}px`;
  el.textContent = text;
  const ga = document.getElementById('game-area');
  if (ga) { ga.appendChild(el); setTimeout(() => el.remove(), 700); }
}

function showStreakLabel(x, y) {
  const el = document.createElement('div');
  el.className = 'score-popup streak';
  el.style.cssText = `left:${x}px;top:${y}px`;
  el.textContent = streak + ' STREAK!';
  const ga = document.getElementById('game-area');
  if (ga) { ga.appendChild(el); setTimeout(() => el.remove(), 700); }
}

function showHitRing(x, y) {
  const el = document.createElement('div');
  el.className = 'hit-ring';
  el.style.cssText = `left:${x}px;top:${y}px;width:${FIXED.size}px;height:${FIXED.size}px`;
  const ga = document.getElementById('game-area');
  if (ga) { ga.appendChild(el); setTimeout(() => el.remove(), 400); }
}

function updateHUD() {
  const sd = document.getElementById('score-display');
  const ad = document.getElementById('acc-display');
  if (sd) sd.textContent = score.toLocaleString();
  const total = hits + misses;
  if (ad) ad.textContent = total > 0 ? Math.round((hits / total) * 100) + '%' : '—';
}

function clearGameArea() {
  const ga = document.getElementById('game-area');
  if (ga) ga.innerHTML = '<div id="miss-flash"></div>';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isGameRunning) endGame();
});

window.addEventListener('DOMContentLoaded', () => {
  // Resume AudioContext on first user interaction (browser autoplay policy)
  document.addEventListener('mousedown', () => { if (audioCtx && audioCtx.state==='suspended') audioCtx.resume(); }, { once:true });
  initCrosshair();

  // mousedown for miss — faster than click, same as hit detection
  const ga = document.getElementById('game-area');
  if (ga) {
    ga.addEventListener('mousedown', e => {
      if (!isGameRunning) return;
      missClick(e);
    });
  }

  // Build avatar picker on profile open
  // (handled in showProfile())
});

// ═══════════════════════════════════════════════════════════
//  SWITCH TRACKING MODE
//  Moving targets + priority rotation. Hit the glowing one.
//  Combines tracking movement with switching priority system.
// ═══════════════════════════════════════════════════════════
const ST_TARGET_COUNT = 3; // targets alive simultaneously
const ST_SPEED_BASE   = 3.0;
const ST_SPEED_VAR    = 1.8;

function startSwitchTracking() {
  const ov = document.getElementById('reaction-overlay');
  if (ov) ov.style.display = 'none';
  clearGameArea();

  const ga = document.getElementById('game-area');
  if (!ga) return;

  // Spawn all 3 targets immediately
  for (let i = 0; i < ST_TARGET_COUNT; i++) {
    spawnSwitchTrackTarget(ga);
  }

  // Give first one priority
  const all = document.querySelectorAll('.target.switchtrack');
  if (all.length > 0) all[0].classList.add('priority');

  // Timer
  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 5) { if (td) td.classList.add('urgent'); playCountdown(); }
    if (timeLeft <= 0) endGame();
  }, 1000);

  // Movement loop (separate from spawnTarget's timer)
  moveSwitchTrackTargets(ga);
}

function spawnSwitchTrackTarget(ga) {
  if (!ga) ga = document.getElementById('game-area');
  if (!ga || !isGameRunning) return;

  const sz     = FIXED.size;
  const margin = sz + 8;
  const W      = ga.offsetWidth, H = ga.offsetHeight;
  const x = margin + Math.random() * (W - margin * 2);
  const y = HUD_HEIGHT + margin + Math.random() * (H - HUD_HEIGHT - margin * 2);

  const t = document.createElement('div');
  t.className = 'target switchtrack';
  t.style.cssText = `width:${sz}px;height:${sz}px;left:${x}px;top:${y}px`;
  t.dataset.angle = Math.random() * Math.PI * 2;
  t.dataset.spd   = ST_SPEED_BASE + Math.random() * ST_SPEED_VAR;
  t.innerHTML = '<div class="target-inner"></div>';

  t.addEventListener('mousedown', e => {
    e.stopPropagation();
    const rect   = t.getBoundingClientRect();
    const gaRect = ga.getBoundingClientRect();
    const lx = rect.left - gaRect.left + rect.width  / 2;
    const ly = rect.top  - gaRect.top  + rect.height / 2;
    hitSwitchTrackTarget(t, lx, ly, ga);
  });

  ga.appendChild(t);
}

function hitSwitchTrackTarget(el, x, y, ga) {
  if (!isGameRunning) return;

  const now = Date.now();
  hitTimestamps.push(now);
  const timeSinceLast = lastHitTime ? (now - lastHitTime) : 9999;
  lastHitTime = now;

  const isPriority = el.classList.contains('priority');

  streak++;
  if (streak > bestStreak) bestStreak = streak;

  let points = 150, bonusText = null;

  if (timeSinceLast < 350)      { points += 120; bonusText = '+120 FAST!'; }
  else if (timeSinceLast < 650) { points += 60;  bonusText = '+60 QUICK';  }

  if (isPriority) {
    points = Math.round(points * 2.2);
    bonusText = '🎯 LOCKED!';
    playPriorityHit();
    hits++; // correct target — counts as hit
  } else {
    // Wrong target: penalty points, streak reset, counted as MISS for honest accuracy
    points = Math.round(points * 0.4);
    streak = 0;
    bonusText = '✗ WRONG';
    playMiss();
    misses++; // Bug 5 fix: was hits++, inflating accuracy to 100%
  }

  const streakMult = 1 + Math.min(0.6, Math.floor(streak / 5) * 0.1);
  points = Math.round(points * streakMult);

  score += points; updateHUD();
  if (isPriority && streak % 5 === 0 && streak > 0) playStreak(streak / 5);

  showScorePopup(x, y, (points > 0 ? '+' : '') + points, false);
  if (bonusText) showScorePopup(x, y - 38, bonusText, true);
  if (streak >= 3 && isPriority) showStreakLabel(x, y + 38);
  showHitRing(x, y);

  // Update streak HUD
  const sEl = document.getElementById('hud-streak');
  const sCount = document.getElementById('streak-count');
  if (sEl && sCount) {
    if (streak >= 3) { sEl.style.display = 'block'; sCount.textContent = streak; }
    else             { sEl.style.display = 'none'; }
  }

  // Remove the hit target
  el.remove();

  // Spawn a replacement
  setTimeout(() => {
    if (!isGameRunning) return;
    const g = document.getElementById('game-area');
    if (g) {
      spawnSwitchTrackTarget(g);
      // Assign priority to a random remaining target
      assignSwitchTrackPriority();
    }
  }, 150);

  // Reassign priority among remaining
  assignSwitchTrackPriority();
}

function assignSwitchTrackPriority() {
  const all = document.querySelectorAll('.target.switchtrack');
  all.forEach(t => t.classList.remove('priority'));
  if (all.length > 0) {
    all[Math.floor(Math.random() * all.length)].classList.add('priority');
  }
}

function moveSwitchTrackTargets(ga) {
  if (!isGameRunning) return;

  const W = ga.offsetWidth, H = ga.offsetHeight;

  document.querySelectorAll('.target.switchtrack').forEach(t => {
    let angle = parseFloat(t.dataset.angle) || 0;
    let spd   = parseFloat(t.dataset.spd)   || ST_SPEED_BASE;
    let x = parseFloat(t.style.left);
    let y = parseFloat(t.style.top);
    const r = FIXED.size / 2 + 4;

    angle += (Math.random() - 0.5) * 0.055; // organic curve

    x += Math.cos(angle) * spd;
    y += Math.sin(angle) * spd;

    if (x < r)            { x = r;            angle = Math.PI - angle + (Math.random()-0.5)*0.3; }
    if (x > W - r)        { x = W - r;        angle = Math.PI - angle + (Math.random()-0.5)*0.3; }
    if (y < HUD_HEIGHT+r) { y = HUD_HEIGHT+r; angle = -angle + (Math.random()-0.5)*0.3; }
    if (y > H - r)        { y = H - r;        angle = -angle + (Math.random()-0.5)*0.3; }

    t.style.left    = x + 'px';
    t.style.top     = y + 'px';
    t.dataset.angle = angle;
    t.dataset.spd   = spd;
  });

  switchTrackFrameId = requestAnimationFrame(() => moveSwitchTrackTargets(ga));
}

// ═══════════════════════════════════════════════════════════
//  SCORE HISTORY  (localStorage, no backend needed)
//  Stores last 20 sessions per mode.
// ═══════════════════════════════════════════════════════════
const HISTORY_KEY = 'aimo_history_v1';
const HISTORY_MAX = 20;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

function saveToHistory(mode, score, accuracy, hits, streak, duration) {
  const all = loadHistory();
  if (!all[mode]) all[mode] = [];
  all[mode].unshift({ score, accuracy, hits, streak, duration, ts: Date.now() });
  if (all[mode].length > HISTORY_MAX) all[mode] = all[mode].slice(0, HISTORY_MAX);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(all)); } catch(e) {}
}

// ── Graph ───────────────────────────────────────────────────
let histActiveMode = 'static';

function buildHistTabs() {
  const tabs = document.getElementById('hist-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  RANKED_MODES.forEach(m => {
    const b = document.createElement('button');
    b.className = 'hist-tab' + (m === histActiveMode ? ' active' : '');
    b.textContent = m === 'switchtrack' ? 'SW.TRK' : m.toUpperCase();
    b.onclick = () => {
      histActiveMode = m;
      document.querySelectorAll('.hist-tab').forEach(t => t.classList.toggle('active', t === b));
      drawHistory();
    };
    tabs.appendChild(b);
  });
}

function drawHistory() {
  const canvas  = document.getElementById('hist-canvas');
  const emptyEl = document.getElementById('hist-empty');
  if (!canvas) return;

  const all     = loadHistory();
  const entries = (all[histActiveMode] || []).slice().reverse(); // oldest→newest
  const ctx     = canvas.getContext('2d');

  canvas.width  = canvas.offsetWidth || 560;
  canvas.height = 160;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!entries.length) {
    if (emptyEl) emptyEl.style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  canvas.style.display = 'block';

  const W = canvas.width, H = canvas.height;
  const pad = { t:16, r:20, b:28, l:48 };
  const gW  = W - pad.l - pad.r;
  const gH  = H - pad.t - pad.b;
  const scores = entries.map(e => e.score);
  const maxS   = Math.max(...scores, 1);
  const n      = entries.length;

  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#00f5ff';

  const xOf = i => pad.l + (n === 1 ? gW / 2 : (i / (n - 1)) * gW);
  const yOf = s => pad.t + gH - (s / maxS) * gH;

  // Grid lines + Y labels
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = pad.t + gH * (1 - f);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '9px Rajdhani, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxS * f).toLocaleString(), pad.l - 6, y + 3);
  });

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + gH);
  // Convert accent hex to rgba for gradient
  const hexToRgba = (hex, a) => {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  };
  const accentClean = accent.length === 7 ? accent : '#00f5ff';
  grad.addColorStop(0,   hexToRgba(accentClean, 0.3));
  grad.addColorStop(1,   hexToRgba(accentClean, 0.0));

  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(scores[0]));
  entries.forEach((e, i) => { if (i > 0) ctx.lineTo(xOf(i), yOf(e.score)); });
  ctx.lineTo(xOf(n - 1), pad.t + gH);
  ctx.lineTo(xOf(0), pad.t + gH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(scores[0]));
  entries.forEach((e, i) => { if (i > 0) ctx.lineTo(xOf(i), yOf(e.score)); });
  ctx.strokeStyle = accentClean;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dots
  const pts = entries.map((e, i) => ({ x:xOf(i), y:yOf(e.score), score:e.score, acc:e.accuracy, streak:e.streak }));
  canvas.dataset.histPts = JSON.stringify(pts);

  pts.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle   = accentClean;
    ctx.strokeStyle = '#05070f';
    ctx.lineWidth   = 2;
    ctx.fill(); ctx.stroke();
  });

  // X labels
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.font = '9px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  entries.forEach((_, i) => {
    if (n <= 10 || i % Math.ceil(n / 8) === 0)
      ctx.fillText(i + 1, xOf(i), H - 6);
  });

  // Best score dashed line
  const bestY = yOf(Math.max(...scores));
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255,215,0,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, bestY); ctx.lineTo(W - pad.r, bestY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,215,0,0.55)';
  ctx.font = '9px Rajdhani, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('BEST', W - pad.r - 2, bestY - 3);
}

// Tooltip on hover — only initialise once per canvas
let _histTipEl = null;
let _histTipBound = false;

function initHistTooltip() {
  const canvas = document.getElementById('hist-canvas');
  if (!canvas || _histTipBound) return;
  _histTipBound = true;

  if (!_histTipEl) {
    _histTipEl = document.createElement('div');
    _histTipEl.style.cssText = [
      'position:fixed','background:rgba(5,7,15,0.92)',
      'border:1px solid rgba(0,245,255,0.3)','color:#e8eef8',
      'font-size:11px','padding:4px 10px','border-radius:2px',
      'pointer-events:none','display:none',
      'font-family:Rajdhani,sans-serif','letter-spacing:1px',
      'z-index:9999','white-space:nowrap'
    ].join(';');
    document.body.appendChild(_histTipEl);
  }

  canvas.addEventListener('mousemove', e => {
    const pts = JSON.parse(canvas.dataset.histPts || '[]');
    if (!pts.length) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top)  * sy;
    const hit = pts.find(p => Math.hypot(p.x - cx, p.y - cy) < 14);
    if (hit) {
      _histTipEl.style.display = 'block';
      _histTipEl.style.left = (e.clientX + 14) + 'px';
      _histTipEl.style.top  = (e.clientY - 30) + 'px';
      _histTipEl.textContent = `${hit.score.toLocaleString()} pts  ·  ${hit.acc}% acc  ·  ${hit.streak} streak`;
    } else {
      _histTipEl.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (_histTipEl) _histTipEl.style.display = 'none';
  });
}

// ═══════════════════════════════════════════════════════════
//  SHARE CARD — generates 600×340 PNG and downloads it
// ═══════════════════════════════════════════════════════════
function shareResult() {
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 600, H = 340;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = 'rgba(0,245,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Read accent from CSS
  const accentHex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00f5ff';

  // Top accent bar
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, W, 3);

  // AIMO wordmark
  ctx.font      = 'bold 26px Orbitron, monospace';
  ctx.fillStyle = accentHex;
  ctx.textAlign = 'left';
  ctx.fillText('AIMO', 28, 44);

  // Mode + duration line
  const modeLabel = (document.getElementById('mode-label-hud')?.textContent || selectedMode).toUpperCase();
  ctx.font      = '11px Rajdhani, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fillText('AIM TRAINER  ·  ' + modeLabel + ' MODE  ·  ' + selectedDuration + 's', 28, 62);

  // Divider
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(28, 72, W - 56, 1);

  // Rank icon + name + username
  const rankIcon = document.getElementById('result-rank-icon')?.textContent || '🩶';
  const rankName = document.getElementById('result-rank-name')?.textContent || 'IRON';
  ctx.font = '44px serif';
  ctx.textAlign = 'left';
  ctx.fillText(rankIcon, 28, 130);

  ctx.font      = 'bold 17px Orbitron, monospace';
  ctx.fillStyle = accentHex;
  ctx.fillText(rankName, 84, 114);

  ctx.font      = '12px Rajdhani, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(currentProfile?.username || '', 84, 132);

  // Stats grid 3×2
  const stats = [
    { label:'SCORE',       val: document.getElementById('final-score')?.textContent    || '0'  },
    { label:'ACCURACY',    val: document.getElementById('final-accuracy')?.textContent || '—'  },
    { label:'HITS',        val: document.getElementById('final-hits')?.textContent     || '0'  },
    { label:'BEST STREAK', val: document.getElementById('final-streak')?.textContent   || '0'  },
    { label:'AVG REACT',   val: document.getElementById('final-react')?.textContent    || '—'  },
    { label:'MISSES',      val: document.getElementById('final-misses')?.textContent   || '0'  },
  ];
  const colW = (W - 56) / 3;
  stats.forEach((s, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const cx  = 28 + col * colW;
    const cy  = 162 + row * 76;

    // Card bg
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, cx, cy, colW - 8, 64, 3);
    ctx.fill();

    // Value
    ctx.font      = 'bold 22px Orbitron, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(s.val, cx + (colW - 8) / 2, cy + 36);

    // Label
    ctx.font      = '10px Rajdhani, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText(s.label, cx + (colW - 8) / 2, cy + 53);
  });

  // Footer
  ctx.font      = '10px Rajdhani, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.textAlign = 'right';
  ctx.fillText('aimo.gg  ·  ' + new Date().toLocaleDateString(), W - 28, H - 12);

  // Download
  const link    = document.createElement('a');
  link.download = 'aimo-result.png';
  link.href     = canvas.toDataURL('image/png');
  link.click();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);   ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);   ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
  ctx.lineTo(x, y + r);       ctx.quadraticCurveTo(x, y,          x + r, y);
  ctx.closePath();
}

// ═══════════════════════════════════════════════════════════
//  DAILY CHALLENGE
//  Same mode + seed every day for all players.
//  Seed is derived from today's date so it's identical globally.
//  One attempt per day stored in localStorage.
// ═══════════════════════════════════════════════════════════
const DAILY_MODES    = ['static','flick','switching','reaction','switchtrack'];
const DAILY_DURS     = [30, 30, 45, 30, 30];
const DAILY_STORE    = 'aimo_daily_v1';

function getDailyKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function getDailyConfig() {
  // Deterministic seed from date
  const key   = getDailyKey();
  let hash    = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const mIdx  = hash % DAILY_MODES.length;
  const dIdx  = hash % DAILY_DURS.length;
  const diffs = ['easy','medium','hard'];
  const diff  = diffs[hash % 3];
  return { mode: DAILY_MODES[mIdx], duration: DAILY_DURS[dIdx], difficulty: diff, key };
}

function loadDailyRecord() {
  try { return JSON.parse(localStorage.getItem(DAILY_STORE) || '{}'); } catch { return {}; }
}

function saveDailyRecord(score, accuracy) {
  const rec = loadDailyRecord();
  rec[getDailyKey()] = { score, accuracy, ts: Date.now(), username: currentProfile?.username || 'GUEST' };
  try { localStorage.setItem(DAILY_STORE, JSON.stringify(rec)); } catch(e) {}
}

function formatCountdown() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const diff = next - now;
  const h = String(Math.floor(diff / 3600000)).padStart(2,'0');
  const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2,'0');
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2,'0');
  return `${h}:${m}:${s}`;
}

let _dailyCountdownTimer = null;

async function showDailyChallenge() {
  showScreen('daily-screen');
  const cfg = getDailyConfig();
  const rec = loadDailyRecord();
  const todayRec = rec[cfg.key];

  // Fill info
  const dateStr = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  _setEl('daily-date',      dateStr);
  _setEl('daily-mode-name', cfg.mode.toUpperCase());
  _setEl('daily-dur-name',  cfg.duration + 's');
  _setEl('daily-diff-name', cfg.difficulty.toUpperCase());

  // Countdown ticker
  if (_dailyCountdownTimer) clearInterval(_dailyCountdownTimer);
  _setEl('daily-countdown', formatCountdown());
  _dailyCountdownTimer = setInterval(() => _setEl('daily-countdown', formatCountdown()), 1000);

  // Played today?
  if (todayRec) {
    document.getElementById('daily-played-block').style.display = 'block';
    document.getElementById('daily-play-block').style.display   = 'none';
    _setEl('daily-played-score', todayRec.score.toLocaleString());
    // Fetch rank
    _setEl('daily-played-rank', 'Loading rank...');
    fetchDailyRank(cfg.key, todayRec.score).then(r => {
      _setEl('daily-played-rank', r ? `🏆 YOU ARE RANK #${r} TODAY` : '');
    });
  } else {
    document.getElementById('daily-played-block').style.display = 'none';
    document.getElementById('daily-play-block').style.display   = 'flex';
  }

  // Load today's top scores
  loadDailyLeaderboard(cfg.key);
}

async function fetchDailyRank(dateKey, userScore) {
  try {
    const { ok, data } = await supabase(
      `/rest/v1/daily_scores?date_key=eq.${dateKey}&score=gt.${userScore}&select=id&limit=500`
    );
    if (ok && Array.isArray(data)) return data.length + 1;
  } catch(e) {}
  return null;
}

async function loadDailyLeaderboard(dateKey) {
  const list = document.getElementById('daily-lb-list');
  if (!list) return;
  list.innerHTML = '<div class="lb-loading">LOADING...</div>';
  try {
    const { ok, data } = await supabase(
      `/rest/v1/daily_scores?date_key=eq.${dateKey}&select=username,score,accuracy&order=score.desc&limit=10`
    );
    if (!ok || !Array.isArray(data) || !data.length) {
      list.innerHTML = '<div class="lb-loading">No scores yet — be the first!</div>'; return;
    }
    const medals  = ['🥇','🥈','🥉'];
    const myName  = currentProfile?.username || '';
    list.innerHTML = data.map((r, i) => `
      <div class="daily-lb-row ${r.username === myName ? 'mine-daily' : ''}">
        <span class="daily-lb-pos">${i < 3 ? medals[i] : i+1}</span>
        <span class="daily-lb-name">${escHtml(r.username)}${r.username===myName?' ◀ YOU':''}</span>
        <span class="daily-lb-score">${r.score.toLocaleString()}</span>
      </div>`).join('');
  } catch(e) {
    list.innerHTML = '<div class="lb-loading">Could not load.</div>';
  }
}

let _isDailyChallenge = false;

function startDailyChallenge() {
  if (currentProfile?.is_guest) {
    alert('Create a free account to submit your daily score to the leaderboard!');
    // Still allow guest play
  }
  const cfg = getDailyConfig();
  _isDailyChallenge = true;
  selectedMode     = cfg.mode;
  selectedDuration = cfg.duration;
  settings.difficulty = cfg.difficulty;
  // Update active button states
  document.querySelectorAll('.mode-card').forEach(b => b.classList.remove('active'));
  const mc = document.getElementById('mode-' + cfg.mode);
  if (mc) mc.classList.add('active');
  document.querySelectorAll('.dur-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.dur) === cfg.duration));
  document.querySelectorAll('.diff-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.diff === cfg.difficulty));
  if (_dailyCountdownTimer) clearInterval(_dailyCountdownTimer);
  startGame();
}

// Hook into endGame to save daily score after a completed challenge
const _origEndGameForDaily = endGame;
// We patch the submit section by checking _isDailyChallenge flag in endGame
// (See endGame's daily save logic injected below)

// ═══════════════════════════════════════════════════════════
//  CROSSHAIR BUILDER
// ═══════════════════════════════════════════════════════════
const xbState = {
  style:   'classic',
  color:   '#00f5ff',
  scale:   1.0,
  opacity: 1.0,
  outline: false,
};

function showCrosshairBuilder() {
  showScreen('crosshair-screen');
  // Sync state from current settings
  xbState.style   = settings.crosshair;
  xbState.color   = settings.xhairColor;
  xbState.scale   = 1.0;
  xbState.opacity = 1.0;
  xbState.outline = false;

  // Reset slider UI
  const sizeSlider    = document.getElementById('xb-size-slider');
  const opSlider      = document.getElementById('xb-opacity-slider');
  const outlineToggle = document.getElementById('xb-outline-toggle');
  const hexInput      = document.getElementById('xb-hex-input');
  if (sizeSlider)    sizeSlider.value = 100;
  if (opSlider)      opSlider.value   = 100;
  if (outlineToggle) outlineToggle.textContent = 'OFF';
  if (hexInput)      hexInput.value   = xbState.color;
  document.getElementById('xb-hex-swatch').style.background = xbState.color;

  // Sync style buttons
  document.querySelectorAll('.xb-container .xhair-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.xhair === xbState.style));
  // Sync color buttons
  document.querySelectorAll('.xb-container .color-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.color === xbState.color));

  xbRender();
}

function xbSetStyle(style) {
  xbState.style = style;
  document.querySelectorAll('.xb-container .xhair-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.xhair === style));
  xbRender();
}

function xbSetColor(color) {
  xbState.color = color;
  document.querySelectorAll('.xb-container .color-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.color === color));
  const hexInput = document.getElementById('xb-hex-input');
  if (hexInput) hexInput.value = color;
  document.getElementById('xb-hex-swatch').style.background = color;
  xbRender();
}

function xbHexInput(val) {
  // Accept valid 6-digit hex
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    xbState.color = val;
    document.getElementById('xb-hex-swatch').style.background = val;
    // Deselect preset buttons since this is custom
    document.querySelectorAll('.xb-container .color-btn').forEach(b => b.classList.remove('active'));
    xbRender();
  }
}

function xbSetScale(val) {
  xbState.scale = val / 100;
  _setEl('xb-size-val', xbState.scale.toFixed(1) + '×');
  xbRender();
}

function xbSetOpacity(val) {
  xbState.opacity = val / 100;
  _setEl('xb-opacity-val', val + '%');
  xbRender();
}

function xbToggleOutline() {
  xbState.outline = !xbState.outline;
  const btn = document.getElementById('xb-outline-toggle');
  if (btn) { btn.textContent = xbState.outline ? 'ON' : 'OFF'; btn.classList.toggle('off', !xbState.outline); }
  xbRender();
}

function xbRender() {
  const preview = document.getElementById('xb-preview');
  if (!preview || !XHAIRS[xbState.style]) return;

  // Build the HTML with scale + opacity + outline applied
  const outline = xbState.outline
    ? `filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000);`
    : '';
  preview.style.cssText = `
    position:relative; z-index:2;
    width:40px; height:40px;
    display:flex; align-items:center; justify-content:center;
    transform:scale(${xbState.scale});
    opacity:${xbState.opacity};
    ${outline}
  `;
  preview.innerHTML = XHAIRS[xbState.style](xbState.color);
}

function xbApply() {
  settings.crosshair  = xbState.style;
  settings.xhairColor = xbState.color;
  if (_xhairEl) {
    // Clear any leftover inline style from builder
    _xhairEl.style.opacity = '';
    _xhairEl.style.scale   = '';
    // Wrap children in a single scaler div so translate3d is never touched
    const filter = xbState.outline
      ? 'drop-shadow(0 0 1.5px #000) drop-shadow(0 0 1.5px #000)' : '';
    _xhairEl.innerHTML = `<div style="
      position:absolute;
      transform:translate(-50%,-50%) scale(${xbState.scale});
      opacity:${xbState.opacity};
      filter:${filter};
      transform-origin:center center;
      pointer-events:none;
    ">${XHAIRS[xbState.style](xbState.color)}</div>`;
  }
  document.querySelectorAll('.xhair-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.xhair === xbState.style));
  document.querySelectorAll('.color-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.color === xbState.color));
  showScreen('menu-screen');
}

// ═══════════════════════════════════════════════════════════
//  SENSITIVITY CONVERTER
//  yaw = degrees turned per mouse count
//  cm360 = centimeters of mouse movement for 360° turn
//  Formula: cm360 = 360 / (yaw * DPI * 2.54)
// ═══════════════════════════════════════════════════════════
const SENS_YAW = {
  val:        0.07,    // Valorant
  csgo:       0.022,   // CS2 / CS:GO
  apex:       0.022,   // Apex (same as CS engine base)
  overwatch:  0.0066,  // Overwatch 2
  fortnite:   0.5715,  // Fortnite (uses FOV-based system, approx at 103 FOV)
  cod:        0.0066,  // COD (Warzone etc)
  r6:         0.00572638, // Rainbow Six Siege
  rust:       0.1,     // Rust
  minecraft:  0.1,     // Minecraft
  roblox:     0.35,    // Roblox
  raw:        null,    // raw cm/360 input
};

function getCm360(game, sens, dpi) {
  if (game === 'raw') return parseFloat(sens);
  const yaw = SENS_YAW[game];
  if (!yaw || !dpi || !sens) return null;
  return 360 / (yaw * sens * dpi / 2.54);
}

function cm360ToSens(game, cm360, dpi) {
  if (game === 'raw') return cm360;
  const yaw = SENS_YAW[game];
  if (!yaw || !dpi) return null;
  return 360 / (yaw * dpi * cm360 / 2.54);
}

function sensCalc() {
  const fromGame = document.getElementById('sens-from-game')?.value;
  const fromSens = parseFloat(document.getElementById('sens-from-val')?.value);
  const fromDpi  = parseFloat(document.getElementById('sens-from-dpi')?.value);
  const toGame   = document.getElementById('sens-to-game')?.value;
  const toDpi    = parseFloat(document.getElementById('sens-to-dpi')?.value);

  const cm360 = getCm360(fromGame, fromSens, fromDpi);

  // Update FROM display
  const fromCmEl = document.getElementById('sens-from-cm');
  if (fromCmEl) fromCmEl.textContent = cm360 ? cm360.toFixed(2) + ' cm/360°' : '— cm/360°';

  const fromEdpi = fromDpi && fromSens ? Math.round(fromDpi * fromSens) : null;
  _setEl('sens-edpi-from', fromEdpi ? fromEdpi.toLocaleString() : '—');
  _setEl('sens-cm360', cm360 ? cm360.toFixed(2) : '—');

  if (!cm360) {
    _setEl('sens-to-val', '—');
    _setEl('sens-to-cm', '— cm/360°');
    _setEl('sens-edpi-to', '—');
    return;
  }

  const toSens = cm360ToSens(toGame, cm360, toDpi);
  const toCmEl = document.getElementById('sens-to-cm');
  if (toCmEl) toCmEl.textContent = cm360.toFixed(2) + ' cm/360°';

  _setEl('sens-to-val', toGame === 'raw' ? cm360.toFixed(2) : (toSens ? toSens.toFixed(4) : '—'));

  const toEdpi = toDpi && toSens ? Math.round(toDpi * toSens) : null;
  _setEl('sens-edpi-to', toEdpi ? toEdpi.toLocaleString() : '—');
}

// ═══════════════════════════════════════════════════════════
//  USER SEARCH + PUBLIC PROFILE
// ═══════════════════════════════════════════════════════════
let _searchTimer = null;

function searchDebounce() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(searchUsers, 420);
}

async function searchUsers() {
  const input = document.getElementById('search-input');
  const query = (input?.value || '').trim().toUpperCase();
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;

  if (query.length < 2) {
    resultsEl.innerHTML = '<div class="search-empty">Type at least 2 characters.</div>';
    return;
  }

  resultsEl.innerHTML = '<div class="search-empty">Searching...</div>';

  try {
    // Supabase: ilike for case-insensitive partial match
    const { ok, data } = await supabase(
      `/rest/v1/profiles?username=ilike.${encodeURIComponent(query + '*')}&select=username,best_score,games_played,avatar&order=best_score.desc&limit=15`
    );
    if (!ok || !Array.isArray(data) || !data.length) {
      resultsEl.innerHTML = '<div class="search-empty">No players found.</div>';
      return;
    }

    resultsEl.innerHTML = data.map(p => {
      const rank = getRank(p.best_score || 0);
      const isMe = p.username === currentProfile?.username;
      return `<div class="search-card" onclick="viewPublicProfile('${escHtml(p.username)}')">
        <div class="search-card-avatar">${escHtml(p.avatar || '🎯')}</div>
        <div class="search-card-info">
          <div class="search-card-name">${escHtml(p.username)}${isMe ? ' <span style="color:var(--accent);font-size:11px">YOU</span>' : ''}</div>
          <div class="search-card-rank">${rank.icon} ${rank.name} · ${(p.games_played||0)} games</div>
        </div>
        <div class="search-card-score">${(p.best_score||0).toLocaleString()}</div>
      </div>`;
    }).join('');
  } catch(e) {
    resultsEl.innerHTML = '<div class="search-error">Search failed. Check connection.</div>';
  }
}

async function viewPublicProfile(username) {
  showScreen('pub-profile-screen');
  // Clear while loading
  _setEl('pub-username', username);
  _setEl('pub-rank-icon', '⏳');
  _setEl('pub-rank-name', 'LOADING...');
  _setEl('pub-global', '');
  _setEl('pub-avatar', '?');
  _setEl('pub-games', '—'); _setEl('pub-hits', '—'); _setEl('pub-best', '—');
  RANKED_MODES.forEach(m => { _setEl('pub-s-'+m,'—'); _setEl('pub-r-'+m,'—'); });

  try {
    const { ok, data } = await supabase(
      `/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=*&limit=1`
    );
    if (!ok || !data?.length) { _setEl('pub-rank-name', 'USER NOT FOUND'); return; }

    const p    = data[0];
    const rank = getRank(p.best_score || 0);
    const prog = getRankProgress(p.best_score || 0);

    _setEl('pub-avatar',    p.avatar || '🎯');
    _setEl('pub-username',  p.username);
    _setEl('pub-rank-icon', rank.icon);
    _setEl('pub-rank-name', rank.name);
    _setEl('pub-games',     (p.games_played||0).toLocaleString());
    _setEl('pub-hits',      (p.total_hits||0).toLocaleString());
    _setEl('pub-best',      (p.best_score||0).toLocaleString());

    // Global rank async
    _setEl('pub-global', 'LOADING RANK...');
    fetchGlobalRank(p.best_score || 0).then(r => {
      _setEl('pub-global', r ? '🌍 GLOBAL RANK #' + r : '🌍 GLOBAL RANK —');
    });

    // Per-mode bests + rank
    for (const mode of RANKED_MODES) {
      const ms = p['best_' + mode] || 0;
      _setEl('pub-s-' + mode, ms > 0 ? ms.toLocaleString() : '—');
      _setEl('pub-r-' + mode, '...');
      if (ms > 0) {
        fetchModeRank(mode, ms).then(r => _setEl('pub-r-' + mode, r ? '#' + r : '—'));
      } else {
        _setEl('pub-r-' + mode, '—');
      }
    }
  } catch(e) {
    _setEl('pub-rank-name', 'ERROR LOADING');
  }
}
