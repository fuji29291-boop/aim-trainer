// ═══════════════════════════════════════════════════════════
//  AIMO — COMPLETE SCRIPT
//  NEW FEATURES:
//  - Offline Mode (Guest)
//  - Daily Challenges
//  - Gridshot Mode
//  - Custom Crosshair Editor
//  - Colorblind & Accessibility Options
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://wncodurkmacfkubnhyhi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_egPhfy4nWgh5Ci0_RGnMhQ_1rJ8J-_k';

// ═══════════════════════════════════════════════════════════
//  RANKS
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
const RANKED_MODES   = ['static','flick','tracking','switching','reaction','switchtrack','gridshot'];
const HUD_HEIGHT     = 58;
const MAX_SCORE_PER_MODE = {
  static: 14000, flick: 19000, tracking: 16000, switching: 16000, reaction: 26000, switchtrack: 19000,
  gridshot: 20000, trace: 999999
};
const MAX_HITS       = 200;
const MIN_MS_PER_HIT = 100;

// ═══════════════════════════════════════════════════════════
//  SETTINGS (with localStorage persistence)
// ═══════════════════════════════════════════════════════════
const settings = {
  size: 60, speed: 5, spawn: 900,
  sound: true, crosshair: 'classic', xhairColor: '#00f5ff',
  difficulty: 'medium', theme: 'cyan',
  customCrosshair: null,
  colorblind: 'none',
  highContrast: false,
  reducedMotion: false
};

function saveSettings() {
  try { localStorage.setItem('aimo_settings', JSON.stringify(settings)); } catch(e) {}
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('aimo_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(settings, parsed);
      document.getElementById('setting-size').value = settings.size;
      document.getElementById('size-val').textContent = settings.size;
      document.getElementById('setting-speed').value = settings.speed;
      document.getElementById('speed-val').textContent = settings.speed;
      document.getElementById('setting-spawn').value = settings.spawn;
      document.getElementById('spawn-val').textContent = settings.spawn;
      const soundBtn = document.getElementById('sound-toggle');
      if (soundBtn) {
        soundBtn.textContent = settings.sound ? 'ON' : 'OFF';
        soundBtn.classList.toggle('off', !settings.sound);
      }
      setCrosshair(settings.crosshair);
      setXhairColor(settings.xhairColor);
      setDifficulty(settings.difficulty);
      setTheme(settings.theme);
      if (settings.colorblind) setColorblindMode(settings.colorblind);
      if (settings.highContrast) document.body.classList.add('high-contrast');
      if (settings.reducedMotion) document.body.classList.add('reduced-motion');
    }
  } catch(e) {}
}

function updateSetting(key, val) {
  settings[key] = Number(val);
  const el = document.getElementById(key + '-val');
  if (el) el.textContent = val;
  saveSettings();
}

function toggleSound() {
  settings.sound = !settings.sound;
  const btn = document.getElementById('sound-toggle');
  if (btn) { btn.textContent = settings.sound ? 'ON' : 'OFF'; btn.classList.toggle('off', !settings.sound); }
  saveSettings();
}

function setTheme(t) {
  settings.theme = t;
  [...document.body.classList].forEach(c => {
    if (c.startsWith('theme-')) document.body.classList.remove(c);
  });
  if (t !== 'cyan') document.body.classList.add('theme-' + t);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
  saveSettings();
}

// ═══════════════════════════════════════════════════════════
//  SOUND ENGINE
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

// Gridshot state
let gridshotCells = [];
let gridshotIndex = 0;

const TRACE_DIFF = {
  easy:   { baseSpeed:1.4, maxSpeed:2.2, turnRate:0.018, size:80, maxDist:55, ppf:2  },
  medium: { baseSpeed:2.8, maxSpeed:4.5, turnRate:0.030, size:60, maxDist:40, ppf:4  },
  hard:   { baseSpeed:5.0, maxSpeed:8.0, turnRate:0.045, size:44, maxDist:28, ppf:7  },
};

const AVATARS = ['🎯','⚡','👾','🔥','💀','🦅','🐉','🦊','🤖','👻','🦁','🐺','🧠','👑','💎','🔮','🌀','⚔️','🛸','🎮'];

// ═══════════════════════════════════════════════════════════
//  OFFLINE MODE (GUEST)
// ═══════════════════════════════════════════════════════════
let isOfflineMode = false;
let offlineProfile = null;
const OFFLINE_PROFILE_KEY = 'aimo_offline_profile';
const OFFLINE_SCORES_KEY = 'aimo_offline_scores';

function playAsGuest() {
  isOfflineMode = true;
  try {
    offlineProfile = JSON.parse(localStorage.getItem(OFFLINE_PROFILE_KEY));
  } catch(e) { offlineProfile = null; }
  if (!offlineProfile) {
    offlineProfile = {
      username: 'GUEST_' + Math.random().toString(36).substr(2,5).toUpperCase(),
      best_score: 0,
      total_hits: 0,
      games_played: 0,
      avatar: '🎮',
      best_static:0, best_flick:0, best_tracking:0, best_switching:0,
      best_reaction:0, best_switchtrack:0, best_gridshot:0
    };
    saveOfflineProfile();
  }
  currentProfile = offlineProfile;
  currentUser = null;
  document.getElementById('offline-indicator').style.display = 'inline-block';
  document.getElementById('menu-leaderboard-btn').style.display = 'none';
  document.getElementById('menu-profile-btn').style.display = 'none';
  document.getElementById('menu-logout-btn').textContent = 'EXIT GUEST';
  enterMenu();
}

function saveOfflineProfile() {
  localStorage.setItem(OFFLINE_PROFILE_KEY, JSON.stringify(offlineProfile));
}

function saveOfflineScore(mode, scoreData) {
  try {
    let scores = JSON.parse(localStorage.getItem(OFFLINE_SCORES_KEY)) || [];
    scores.push({...scoreData, mode, date: new Date().toISOString()});
    if (scores.length > 50) scores = scores.slice(-50);
    localStorage.setItem(OFFLINE_SCORES_KEY, JSON.stringify(scores));
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
//  DAILY CHALLENGE
// ═══════════════════════════════════════════════════════════
let dailyChallenge = null;
const DAILY_KEY = 'aimo_daily_challenge';

function generateDailyChallenge() {
  const today = new Date().toISOString().split('T')[0];
  const stored = localStorage.getItem(DAILY_KEY);
  let challenge;
  if (stored) {
    challenge = JSON.parse(stored);
    if (challenge.date !== today) challenge = null;
  }
  if (!challenge) {
    const modes = ['static','flick','tracking','switching','gridshot'];
    const mode = modes[Math.floor(Math.random() * modes.length)];
    const duration = [30,45,60][Math.floor(Math.random()*3)];
    const targetScore = mode === 'gridshot' ? 45 : (mode === 'flick' ? 8000 : 6000);
    challenge = {
      date: today,
      mode, duration, targetScore,
      completed: false,
      bestScore: 0
    };
    localStorage.setItem(DAILY_KEY, JSON.stringify(challenge));
  }
  dailyChallenge = challenge;
  updateDailyUI();
}

function updateDailyUI() {
  if (!dailyChallenge) return;
  const modeNames = {static:'Static',flick:'Flick',tracking:'Tracking',switching:'Switching',gridshot:'Gridshot'};
  document.getElementById('daily-desc').textContent = 
    `${modeNames[dailyChallenge.mode]} · ${dailyChallenge.duration}s · Target: ${dailyChallenge.targetScore} pts`;
  const pct = Math.min(100, (dailyChallenge.bestScore / dailyChallenge.targetScore) * 100);
  document.getElementById('daily-progress-fill').style.width = pct + '%';
  document.getElementById('daily-progress-text').textContent = `${dailyChallenge.bestScore}/${dailyChallenge.targetScore}`;
  const status = dailyChallenge.completed ? '✅' : (dailyChallenge.bestScore >= dailyChallenge.targetScore ? '🎉' : '🔒');
  document.getElementById('daily-status').textContent = status;
}

function startDailyChallenge() {
  if (!dailyChallenge) generateDailyChallenge();
  selectedMode = dailyChallenge.mode;
  selectedDuration = dailyChallenge.duration;
  startGame();
}

// ═══════════════════════════════════════════════════════════
//  SUPABASE
// ═══════════════════════════════════════════════════════════
async function supabase(path, opts = {}, token = null) {
  if (isOfflineMode) return { ok: false, data: { message: 'Offline mode' } };
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
  if (isOfflineMode) return null;
  try {
    const { ok, data } = await supabase(`/rest/v1/profiles?best_score=gt.${score}&select=id&limit=2000`);
    if (ok && Array.isArray(data)) return data.length + 1;
  } catch(e) {}
  return null;
}

async function fetchModeRank(mode, userScore) {
  if (!userScore || userScore <= 0) return null;
  if (isOfflineMode) return null;
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

    const check = await supabase(`/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`, {}, SUPABASE_KEY);
    if (check.ok && Array.isArray(check.data) && check.data.length > 0)
      throw new Error('Username already taken. Choose another.');

    const auth = await supabase('/auth/v1/signup', { method:'POST', body:JSON.stringify({ email, password }) }, SUPABASE_KEY);
    if (!auth.ok || !auth.data?.user?.id)
      throw new Error(auth.data?.msg || auth.data?.error_description || 'Registration failed.');

    const uid = auth.data.user.id, token = auth.data.access_token;

    const profData = {
      id:uid, username, best_score:0, total_hits:0, games_played:0, avatar:'🎯',
      best_static:0, best_flick:0, best_tracking:0, best_switching:0, best_reaction:0, best_switchtrack:0, best_gridshot:0
    };
    const profRes = await supabase('/rest/v1/profiles', { method:'POST', body:JSON.stringify(profData) }, token);
    if (!profRes.ok) throw new Error('Account created but profile save failed. Try logging in.');

    currentUser    = { id:uid, access_token:token, email };
    currentProfile = profData;
    isOfflineMode = false;
    document.getElementById('offline-indicator').style.display = 'none';
    document.getElementById('menu-leaderboard-btn').style.display = 'inline-block';
    document.getElementById('menu-profile-btn').style.display = 'inline-block';
    document.getElementById('menu-logout-btn').textContent = 'LOGOUT';
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
    for (const m of RANKED_MODES) {
      if (currentProfile['best_' + m] === undefined) currentProfile['best_' + m] = 0;
    }
    if (!currentProfile.avatar) currentProfile.avatar = '🎯';

    isOfflineMode = false;
    document.getElementById('offline-indicator').style.display = 'none';
    document.getElementById('menu-leaderboard-btn').style.display = 'inline-block';
    document.getElementById('menu-profile-btn').style.display = 'inline-block';
    document.getElementById('menu-logout-btn').textContent = 'LOGOUT';
    await enterMenu();
  } catch(e) {
    errEl.textContent = e.message;
  } finally {
    btn.querySelector('span').textContent = 'LOGIN';
    btn.disabled = false;
  }
}

function logout() {
  if (isOfflineMode) {
    isOfflineMode = false;
    offlineProfile = null;
    currentProfile = null;
    showScreen('auth-screen');
    document.getElementById('offline-indicator').style.display = 'none';
    document.getElementById('menu-leaderboard-btn').style.display = 'inline-block';
    document.getElementById('menu-profile-btn').style.display = 'inline-block';
    document.getElementById('menu-logout-btn').textContent = 'LOGOUT';
  } else {
    currentUser = null; currentProfile = null;
    showScreen('auth-screen');
  }
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

  if (!isOfflineMode) {
    fetchGlobalRank(currentProfile.best_score).then(r => {
      _setEl('badge-global-rank', r ? '🌍 #' + r : '');
    });
  } else {
    _setEl('badge-global-rank', '📴 OFFLINE');
  }

  generateDailyChallenge();
  showScreen('menu-screen');
}

// ═══════════════════════════════════════════════════════════
//  PROFILE SCREEN
// ═══════════════════════════════════════════════════════════
async function showProfile() {
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

  const fillEl = document.getElementById('prof-progress-fill');
  if (fillEl) fillEl.style.width = prog.pct + '%';
  _setEl('prof-cur-rank',       rank.icon + ' ' + rank.name);
  _setEl('prof-next-rank',      prog.next ? prog.next.icon + ' ' + prog.next.name : '✦ MAX');
  _setEl('prof-progress-label', prog.next ? `${(p.best_score||0).toLocaleString()} / ${prog.next.min.toLocaleString()}` : 'MAX RANK');
  _setEl('prof-progress-sub',   prog.next ? `${prog.pct}% — ${prog.pointsNeeded.toLocaleString()} pts to ${prog.next.name}` : 'You have reached the highest rank!');

  if (!isOfflineMode) {
    _setEl('prof-global', 'LOADING...');
    fetchGlobalRank(p.best_score).then(r => {
      _setEl('prof-global', r ? '🌍 GLOBAL RANK #' + r : '🌍 GLOBAL RANK —');
    });
  } else {
    _setEl('prof-global', '📴 OFFLINE MODE');
  }

  for (const mode of RANKED_MODES) {
    const ms = p['best_' + mode] || 0;
    _setEl('prof-best-' + mode, ms > 0 ? ms.toLocaleString() : '—');
    if (!isOfflineMode) {
      _setEl('prof-rank-' + mode, '...');
      if (ms > 0) {
        fetchModeRank(mode, ms).then(r => {
          _setEl('prof-rank-' + mode, r ? '#' + r : '—');
        });
      } else {
        _setEl('prof-rank-' + mode, '—');
      }
    } else {
      _setEl('prof-rank-' + mode, '📴');
    }
  }
  _setEl('prof-best-trace', '—');

  buildAvatarPicker();
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
  if (!currentUser && !isOfflineMode) return;
  currentProfile.avatar = emoji;
  _setEl('prof-avatar', emoji);
  _setEl('badge-avatar', emoji);
  document.querySelectorAll('.avatar-opt').forEach(b => b.classList.toggle('active', b.textContent === emoji));
  if (isOfflineMode) {
    saveOfflineProfile();
  } else {
    await supabase(`/rest/v1/profiles?id=eq.${currentUser.id}`, {
      method:'PATCH', body:JSON.stringify({ avatar: emoji })
    });
  }
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
function disableSettingsInputs(disable) {
  const inputs = document.querySelectorAll('#settings-body input, #settings-body button, .dur-btn, .mode-card, .settings-title');
  inputs.forEach(el => el.disabled = disable);
}

function startGame() {
  if (!currentProfile) {
    if (isOfflineMode) {
      playAsGuest();
    } else {
      return showScreen('auth-screen');
    }
  }

  disableSettingsInputs(true);

  score = 0; hits = 0; misses = 0; timeLeft = selectedDuration;
  streak = 0; bestStreak = 0; lastHitTime = 0;
  hitTimestamps = []; reactionTimes = [];
  sessionStartTime = Date.now();
  isGameRunning = true;

  stopTracking(); stopTraceMode(); stopSwitchTracking();
  clearGameArea(); updateHUD();

  showScreen('game-screen');
  document.getElementById('timer-display').classList.remove('urgent');
  _setEl('mode-label-hud', selectedMode.toUpperCase());
  const streakEl = document.getElementById('hud-streak');
  if (streakEl) streakEl.style.display = 'none';

  const reactEl = document.getElementById('reaction-overlay');
  if (reactEl) reactEl.style.display = 'none';

  if (selectedMode === 'reaction')    { startReactionMode();    return; }
  if (selectedMode === 'trace')       { startTraceMode();       return; }
  if (selectedMode === 'switchtrack') { startSwitchTracking(); return; }
  if (selectedMode === 'gridshot')    { startGridshot();        return; }

  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 5) { if (td) td.classList.add('urgent'); playCountdown(); }
    if (timeLeft <= 0) endGame();
  }, 1000);

  const intervals = { static: settings.spawn, flick: 1200, tracking: 2200, switching: 650 };
  const interval  = intervals[selectedMode] || settings.spawn;
  spawnTimer = setInterval(spawnTarget, interval);
  spawnTarget();

  if (selectedMode === 'tracking') startTracking();
  if (selectedMode === 'switching') {
    setTimeout(spawnTarget, 200);
    setTimeout(spawnTarget, 450);
  }
}

// ═══════════════════════════════════════════════════════════
//  GRIDSHOT MODE
// ═══════════════════════════════════════════════════════════
function startGridshot() {
  const ga = document.getElementById('game-area');
  const W = ga.offsetWidth, H = ga.offsetHeight;
  const cellW = W / 3, cellH = (H - HUD_HEIGHT) / 3;
  gridshotCells = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      gridshotCells.push({
        x: col * cellW + cellW/2,
        y: HUD_HEIGHT + row * cellH + cellH/2
      });
    }
  }
  gridshotIndex = 0;
  spawnGridshotTarget();

  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 5) { if (td) td.classList.add('urgent'); playCountdown(); }
    if (timeLeft <= 0) endGame();
  }, 1000);
}

function spawnGridshotTarget() {
  if (!isGameRunning || selectedMode !== 'gridshot') return;
  clearGameArea();
  const ga = document.getElementById('game-area');
  const pos = gridshotCells[gridshotIndex % gridshotCells.length];
  const sz = settings.size;
  const target = document.createElement('div');
  target.className = 'target gridshot';
  target.style.cssText = `width:${sz}px;height:${sz}px;left:${pos.x}px;top:${pos.y}px`;
  target.innerHTML = '<div class="target-inner"></div>';
  target.addEventListener('mousedown', e => {
    e.stopPropagation();
    handleGridshotHit(target);
  });
  ga.appendChild(target);
}

function handleGridshotHit(el) {
  if (!isGameRunning) return;
  const now = Date.now();
  const timeSinceLast = lastHitTime ? (now - lastHitTime) : 9999;
  hitTimestamps.push(now);
  lastHitTime = now;
  streak++;
  if (streak > bestStreak) bestStreak = streak;
  let points = 100 + Math.max(0, 150 - Math.floor(timeSinceLast / 2));
  points = Math.round(points * (1 + Math.min(0.5, Math.floor(streak/5)*0.1)));
  hits++; score += points; updateHUD();
  playHit();
  const rect = el.getBoundingClientRect();
  const gaRect = document.getElementById('game-area').getBoundingClientRect();
  const x = rect.left - gaRect.left + rect.width/2;
  const y = rect.top - gaRect.top + rect.height/2;
  showScorePopup(x, y, '+' + points, false);
  if (streak >= 3) showStreakLabel(x, y + 38);
  showHitRing(x, y);
  el.remove();
  gridshotIndex++;
  spawnGridshotTarget();

  const sEl = document.getElementById('hud-streak');
  const sCount = document.getElementById('streak-count');
  if (sEl && sCount) {
    if (streak >= 3) { sEl.style.display = 'block'; sCount.textContent = streak; }
    else { sEl.style.display = 'none'; }
  }
}

// ═══════════════════════════════════════════════════════════
//  TRACKING MODE MOVEMENT
// ═══════════════════════════════════════════════════════════
function startTracking() {
  function frame() {
    if (!isGameRunning) return;
    const ga = document.getElementById('game-area');
    if (!ga) return;
    const W = ga.offsetWidth, H = ga.offsetHeight;

    document.querySelectorAll('.target.tracking').forEach(t => {
      let angle = parseFloat(t.dataset.angle) || 0;
      let spd   = parseFloat(t.dataset.spd)   || 3;
      let x = parseFloat(t.style.left);
      let y = parseFloat(t.style.top);
      const r = settings.size / 2 + 4;

      angle += (Math.random() - 0.5) * 0.05;

      x += Math.cos(angle) * spd;
      y += Math.sin(angle) * spd;

      if (x < r)   { x = r;   angle = Math.PI - angle + (Math.random()-0.5)*0.3; }
      if (x > W-r) { x = W-r; angle = Math.PI - angle + (Math.random()-0.5)*0.3; }
      if (y < HUD_HEIGHT+r) { y = HUD_HEIGHT+r; angle = -angle + (Math.random()-0.5)*0.3; }
      if (y > H-r)          { y = H-r;          angle = -angle + (Math.random()-0.5)*0.3; }

      t.style.left     = x + 'px';
      t.style.top      = y + 'px';
      t.dataset.angle  = angle;
      t.dataset.spd    = spd;
    });
    trackingFrameId = requestAnimationFrame(frame);
  }
  trackingFrameId = requestAnimationFrame(frame);
}
function stopTracking() {
  if (trackingFrameId) { cancelAnimationFrame(trackingFrameId); trackingFrameId = null; }
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

  const delay = 800 + Math.random() * 2200;
  reactionTimeout = setTimeout(() => {
    if (!isGameRunning) return;
    const ga = document.getElementById('game-area');
    if (!ga) return;
    const sz = settings.size;
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
  if (!isGameRunning || selectedMode === 'reaction' || selectedMode === 'trace' || selectedMode === 'switchtrack' || selectedMode === 'gridshot') return;

  if (selectedMode === 'tracking' && document.querySelectorAll('.target.tracking').length >= 3) return;

  const ga = document.getElementById('game-area');
  if (!ga) return;
  const sz = settings.size, margin = sz + 4;
  const x  = Math.random() * (ga.offsetWidth  - margin*2) + margin;
  const y  = Math.random() * (ga.offsetHeight - margin*2 - HUD_HEIGHT) + margin + HUD_HEIGHT;

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
    const spd = 2.5 + Math.random() * (settings.speed * 0.5);
    target.dataset.angle = Math.random() * Math.PI * 2;
    target.dataset.spd   = spd;
  }

  target.innerHTML = '<div class="target-inner"></div>';

  target.addEventListener('mousedown', e => {
    e.stopPropagation();
    const rect  = target.getBoundingClientRect();
    const gaRect = ga.getBoundingClientRect();
    const liveX  = rect.left - gaRect.left + rect.width / 2;
    const liveY  = rect.top  - gaRect.top  + rect.height / 2;
    hitTarget(target, liveX, liveY);
  });

  ga.appendChild(target);

  const ttl = { static:2400, flick:650, tracking:99999, switching:3000 }[selectedMode] || 2400;

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

  if (timeSinceLast < 350)       { points += 120; bonusText = '+120 FAST!'; }
  else if (timeSinceLast < 650)  { points += 60;  bonusText = '+60 QUICK';  }

  if (selectedMode === 'flick')        points = Math.round(points * 1.8);
  if (selectedMode === 'tracking')     points = Math.round(points * 1.5);
  if (selectedMode === 'switchtrack' && isPriority)  { points = Math.round(points * 2.2); bonusText = '+LOCK!'; }
  if (selectedMode === 'switchtrack' && !isPriority) { points = Math.round(points * 0.5); }
  if (selectedMode === 'switching' && isPriority) { points += 200; bonusText = '+200 PRIORITY!'; }

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
  if (selectedMode === 'trace') return;
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

  const sEl = document.getElementById('hud-streak');
  if (sEl) sEl.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  VALIDATE
// ═══════════════════════════════════════════════════════════
function validateScore() {
  if (selectedMode === 'trace') return { valid:false, reason:'TRACE IS TRAINING ONLY — not ranked' };

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
  if (!isGameRunning) return;
  isGameRunning = false;

  disableSettingsInputs(false);

  clearInterval(gameTimer); clearInterval(spawnTimer);
  clearTimeout(reactionTimeout);
  stopTracking(); stopTraceMode(); stopSwitchTracking();
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
  statusEl.textContent = 'VALIDATING & SUBMITTING...'; statusEl.className = 'submit-status';

  const check = validateScore();
  if (!check.valid) {
    statusEl.textContent = '⚠ ' + check.reason;
    statusEl.className = 'submit-status error';
    return;
  }

  // Update daily challenge
  if (dailyChallenge && selectedMode === dailyChallenge.mode && selectedDuration === dailyChallenge.duration) {
    if (score > dailyChallenge.bestScore) {
      dailyChallenge.bestScore = score;
      if (score >= dailyChallenge.targetScore) dailyChallenge.completed = true;
      localStorage.setItem(DAILY_KEY, JSON.stringify(dailyChallenge));
      updateDailyUI();
    }
  }

  if (isOfflineMode) {
    const modeCol = 'best_' + selectedMode;
    const newBest = Math.max(score, currentProfile.best_score || 0);
    const newModeBest = Math.max(score, currentProfile[modeCol] || 0);
    const newHits = (currentProfile.total_hits || 0) + hits;
    const newGames = (currentProfile.games_played || 0) + 1;

    currentProfile.best_score = newBest;
    currentProfile.total_hits = newHits;
    currentProfile.games_played = newGames;
    currentProfile[modeCol] = newModeBest;
    saveOfflineProfile();
    saveOfflineScore(selectedMode, { score, accuracy, hits, bestStreak, duration: selectedDuration });

    const rankUpd = getRank(newBest);
    const progUpd = getRankProgress(newBest);
    _setEl('badge-best', 'Best: ' + newBest.toLocaleString());
    _setEl('badge-rank-icon', rankUpd.icon);
    _setEl('badge-rank-name', rankUpd.name);
    const bfEl = document.getElementById('badge-rank-fill');
    if (bfEl) bfEl.style.width = progUpd.pct + '%';
    _setEl('badge-rank-next', progUpd.next ? progUpd.pointsNeeded.toLocaleString() + ' pts → ' + progUpd.next.name : '✦ MAX RANK');

    statusEl.textContent = '✓ SCORE SAVED LOCALLY (OFFLINE)';
    statusEl.className = 'submit-status success';
    saveToHistory(selectedMode, score, accuracy, hits, bestStreak, selectedDuration);
    return;
  }

  // Online submission
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

    const rankUpd = getRank(newBest);
    const progUpd = getRankProgress(newBest);
    _setEl('badge-best',      'Best: ' + newBest.toLocaleString());
    _setEl('badge-rank-icon', rankUpd.icon);
    _setEl('badge-rank-name', rankUpd.name);
    const bfEl = document.getElementById('badge-rank-fill');
    if (bfEl) bfEl.style.width = progUpd.pct + '%';
    _setEl('badge-rank-next', progUpd.next ? progUpd.pointsNeeded.toLocaleString() + ' pts → ' + progUpd.next.name : '✦ MAX RANK');

    statusEl.textContent = '✓ SCORE SUBMITTED'; statusEl.className = 'submit-status success';
    saveToHistory(selectedMode, score, accuracy, hits, bestStreak, selectedDuration);

    const modeRank = await fetchModeRank(selectedMode, score);
    if (modeRank) {
      const mrEl = document.getElementById('result-mode-rank');
      if (mrEl) {
        mrEl.style.display = 'block';
        _setEl('result-mode-rank-text', `🎯 YOU ARE RANK #${modeRank} GLOBALLY IN ${selectedMode.toUpperCase()}`);
      }
    }

    const globalR = await fetchGlobalRank(newBest);
    if (globalR) _setEl('badge-global-rank', '🌍 #' + globalR);

  } catch(e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.className = 'submit-status error';
  }
}

// ═══════════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════════
async function showLeaderboard() {
  if (isOfflineMode) {
    alert('Leaderboard not available in offline mode.');
    return;
  }
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
  if (isOfflineMode) return;
  const list       = document.getElementById('lb-list');
  const yourRankEl = document.getElementById('lb-your-rank');
  const yourRankNm = document.getElementById('lb-your-rank-num');
  list.innerHTML = '<div class="lb-loading">FETCHING SCORES...</div>';
  if (yourRankEl) yourRankEl.style.display = 'none';

  const modeCol = 'best_' + currentLbTab;

  try {
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

// ═══════════════════════════════════════════════════════════
//  TRACE MODE
// ═══════════════════════════════════════════════════════════
function startTraceMode() {
  const ov = document.getElementById('reaction-overlay');
  if (ov) ov.style.display = 'none';
  clearGameArea();

  const ga   = document.getElementById('game-area');
  if (!ga) return;
  const diff = TRACE_DIFF[settings.difficulty] || TRACE_DIFF.medium;
  const rect = ga.getBoundingClientRect();

  traceX = rect.width / 2; traceY = rect.height / 2;
  traceMouseX = rect.width / 2; traceMouseY = rect.height / 2;
  traceAngle = Math.random() * Math.PI * 2;
  traceSpeed = diff.baseSpeed;
  traceOnFrames = 0; traceTotalFrames = 0; traceChangeTimer = 0;

  pickNewTarget(ga, diff);

  const sz = diff.size;
  const circle = document.createElement('div');
  circle.id = 'trace-circle';
  circle.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#00ffcc,#0088aa);box-shadow:0 0 18px rgba(0,255,200,0.7);border:2px solid rgba(0,255,200,0.9);transform:translate(-50%,-50%);pointer-events:none;`;
  ga.appendChild(circle);

  const ring = document.createElement('div');
  ring.id = 'trace-ring';
  ring.style.cssText = `position:absolute;width:${sz+28}px;height:${sz+28}px;border-radius:50%;border:2px dashed rgba(0,255,200,0.3);transform:translate(-50%,-50%);pointer-events:none;`;
  ga.appendChild(ring);

  const status = document.createElement('div');
  status.id = 'trace-status';
  status.textContent = 'KEEP YOUR CURSOR INSIDE THE RING';
  ga.appendChild(status);

  ga.addEventListener('mousemove', onTraceMouseMove);

  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 5) { if (td) td.classList.add('urgent'); }
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
  const ga = document.getElementById('game-area');
  if (!ga) return;
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
  if (traceSpeed < diff.maxSpeed) traceSpeed += 0.005;

  traceX += Math.cos(traceAngle) * traceSpeed;
  traceY += Math.sin(traceAngle) * traceSpeed;

  const sz = diff.size / 2;
  const W = ga.offsetWidth, H = ga.offsetHeight;
  if (traceX < sz)   { traceX = sz;   traceAngle = Math.PI - traceAngle + (Math.random()-0.5)*0.4; }
  if (traceX > W-sz) { traceX = W-sz; traceAngle = Math.PI - traceAngle + (Math.random()-0.5)*0.4; }
  if (traceY < HUD_HEIGHT+sz) { traceY = HUD_HEIGHT+sz; traceAngle = -traceAngle + (Math.random()-0.5)*0.4; }
  if (traceY > H-sz)          { traceY = H-sz;          traceAngle = -traceAngle + (Math.random()-0.5)*0.4; }

  traceChangeTimer--;
  if (traceChangeTimer <= 0) pickNewTarget(ga, diff);

  const circle = document.getElementById('trace-circle');
  const ring   = document.getElementById('trace-ring');
  const status = document.getElementById('trace-status');
  if (!circle) return;

  circle.style.left = traceX + 'px'; circle.style.top = traceY + 'px';
  ring.style.left   = traceX + 'px'; ring.style.top   = traceY + 'px';

  const dx = traceMouseX - traceX, dy = traceMouseY - traceY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  traceTotalFrames++;

  if (dist <= diff.maxDist) {
    const prox = 1 - dist / diff.maxDist;
    score += Math.round(diff.ppf * prox);
    traceOnFrames++;
    circle.style.boxShadow = '0 0 22px rgba(0,255,150,0.9),0 0 50px rgba(0,255,150,0.4)';
    ring.style.borderColor  = 'rgba(0,255,150,0.7)';
    if (status) { status.textContent = prox > 0.7 ? '🎯 PERFECT' : '✓ ON TARGET'; status.style.color = '#00ff88'; }
  } else {
    const howFar = Math.min(1, (dist - diff.maxDist) / 100);
    circle.style.boxShadow = `0 0 14px rgba(255,80,80,${0.4+howFar*0.4})`;
    ring.style.borderColor  = `rgba(255,80,80,${0.4+howFar*0.4})`;
    if (status) { status.textContent = '✗ STAY ON TARGET'; status.style.color = '#ff4455'; }
  }

  const sd = document.getElementById('score-display');
  const ad = document.getElementById('acc-display');
  if (sd) sd.textContent = score;
  if (ad) ad.textContent = traceTotalFrames > 0 ? Math.round((traceOnFrames / traceTotalFrames) * 100) + '%' : '—';

  traceFrameId = requestAnimationFrame(() => traceLoop(diff, ga));
}

function stopTraceMode() {
  if (traceFrameId) { cancelAnimationFrame(traceFrameId); traceFrameId = null; }
  const ga = document.getElementById('game-area');
  if (ga) ga.removeEventListener('mousemove', onTraceMouseMove);
}

// ═══════════════════════════════════════════════════════════
//  CROSSHAIR
// ═══════════════════════════════════════════════════════════
let _xhairEl = null;
let customCrosshairParams = { length: 18, thickness: 2, gap: 0, dotSize: 3, opacity: 1, color: '#00f5ff' };

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
  document.addEventListener('mousemove', e => {
    if (_xhairEl) {
      _xhairEl.style.transform = `translate3d(${e.clientX - 16}px,${e.clientY - 16}px,0)`;
    }
  }, { passive: true });
  document.addEventListener('mouseleave', () => {
    if (_xhairEl) _xhairEl.style.opacity = '0';
  });
  document.addEventListener('mouseenter', () => {
    if (_xhairEl) _xhairEl.style.opacity = '1';
  });
  setCrosshair(settings.crosshair);
}

function setCrosshair(style) {
  if (style === 'custom') {
    openCrosshairEditor();
    return;
  }
  settings.crosshair = style;
  if (_xhairEl && XHAIRS[style]) _xhairEl.innerHTML = XHAIRS[style](settings.xhairColor);
  document.querySelectorAll('.xhair-btn').forEach(b => b.classList.toggle('active', b.dataset.xhair === style));
  saveSettings();
}

function setXhairColor(color) {
  settings.xhairColor = color;
  if (settings.crosshair !== 'custom') setCrosshair(settings.crosshair);
  document.querySelectorAll('.color-btn').forEach(b => b.classList.toggle('active', b.dataset.color === color));
  saveSettings();
}

function setDifficulty(d) {
  settings.difficulty = d;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === d));
  saveSettings();
}

function openCrosshairEditor() {
  const modal = document.getElementById('crosshair-editor-modal');
  modal.style.display = 'flex';
  const saved = settings.customCrosshair;
  if (saved) Object.assign(customCrosshairParams, saved);
  document.getElementById('custom-length').value = customCrosshairParams.length;
  document.getElementById('custom-thickness').value = customCrosshairParams.thickness;
  document.getElementById('custom-gap').value = customCrosshairParams.gap;
  document.getElementById('custom-dot').value = customCrosshairParams.dotSize;
  document.getElementById('custom-opacity').value = customCrosshairParams.opacity;
  document.getElementById('custom-color').value = customCrosshairParams.color;
  updateCrosshairPreview();
  ['length','thickness','gap','dot','opacity','color'].forEach(id => {
    document.getElementById('custom-'+id).addEventListener('input', updateCrosshairPreview);
  });
}

function updateCrosshairPreview() {
  const p = {
    length: +document.getElementById('custom-length').value,
    thickness: +document.getElementById('custom-thickness').value,
    gap: +document.getElementById('custom-gap').value,
    dotSize: +document.getElementById('custom-dot').value,
    opacity: +document.getElementById('custom-opacity').value,
    color: document.getElementById('custom-color').value
  };
  customCrosshairParams = p;
  document.getElementById('xhair-preview').innerHTML = generateCustomCrosshairHTML(p);
}

function generateCustomCrosshairHTML(p) {
  const c = p.color;
  const opacity = p.opacity;
  const style = `style="position:absolute;background:${c};opacity:${opacity}"`;
  const len = p.length, thick = p.thickness, gap = p.gap;
  return `
    <div ${style} style="width:${len}px;height:${thick}px;top:50%;left:50%;transform:translate(-50%,-50%) translateX(${gap}px)"></div>
    <div ${style} style="width:${len}px;height:${thick}px;top:50%;left:50%;transform:translate(-50%,-50%) translateX(-${gap}px)"></div>
    <div ${style} style="width:${thick}px;height:${len}px;top:50%;left:50%;transform:translate(-50%,-50%) translateY(${gap}px)"></div>
    <div ${style} style="width:${thick}px;height:${len}px;top:50%;left:50%;transform:translate(-50%,-50%) translateY(-${gap}px)"></div>
    ${p.dotSize > 0 ? `<div ${style} style="width:${p.dotSize}px;height:${p.dotSize}px;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)"></div>` : ''}
  `;
}

function applyCustomCrosshair() {
  settings.crosshair = 'custom';
  settings.customCrosshair = {...customCrosshairParams};
  if (_xhairEl) _xhairEl.innerHTML = generateCustomCrosshairHTML(customCrosshairParams);
  closeCrosshairEditor();
  saveSettings();
  document.querySelectorAll('.xhair-btn').forEach(b => b.classList.remove('active'));
}

function closeCrosshairEditor() {
  document.getElementById('crosshair-editor-modal').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  COLORBLIND & ACCESSIBILITY
// ═══════════════════════════════════════════════════════════
function setColorblindMode(mode) {
  settings.colorblind = mode;
  const ga = document.getElementById('game-area');
  const filters = {
    protanopia: 'url(#protanopia)',
    deuteranopia: 'url(#deuteranopia)',
    tritanopia: 'url(#tritanopia)'
  };
  if (mode === 'none') {
    if (ga) ga.style.filter = 'none';
  } else {
    if (!document.getElementById('cb-filters')) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'cb-filters';
      svg.style.display = 'none';
      svg.innerHTML = `
        <filter id="protanopia"><feColorMatrix type="matrix" values="0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0"/></filter>
        <filter id="deuteranopia"><feColorMatrix type="matrix" values="0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0"/></filter>
        <filter id="tritanopia"><feColorMatrix type="matrix" values="0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0"/></filter>
      `;
      document.body.appendChild(svg);
    }
    if (ga) ga.style.filter = filters[mode];
  }
  saveSettings();
}

function toggleHighContrast(enabled) {
  document.body.classList.toggle('high-contrast', enabled);
  settings.highContrast = enabled;
  saveSettings();
}

function toggleReducedMotion(enabled) {
  document.body.classList.toggle('reduced-motion', enabled);
  settings.reducedMotion = enabled;
  saveSettings();
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
  el.style.cssText = `left:${x}px;top:${y}px;width:${settings.size}px;height:${settings.size}px`;
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
//  SWITCH TRACKING MODE
// ═══════════════════════════════════════════════════════════
const ST_TARGET_COUNT = 3;
const ST_SPEED_BASE   = 3.0;
const ST_SPEED_VAR    = 1.8;

function startSwitchTracking() {
  const ov = document.getElementById('reaction-overlay');
  if (ov) ov.style.display = 'none';
  clearGameArea();

  const ga = document.getElementById('game-area');
  if (!ga) return;

  for (let i = 0; i < ST_TARGET_COUNT; i++) {
    spawnSwitchTrackTarget(ga);
  }

  const all = document.querySelectorAll('.target.switchtrack');
  if (all.length > 0) all[0].classList.add('priority');

  gameTimer = setInterval(() => {
    timeLeft--;
    const td = document.getElementById('timer-display');
    if (td) td.textContent = timeLeft;
    if (timeLeft <= 5) { if (td) td.classList.add('urgent'); playCountdown(); }
    if (timeLeft <= 0) endGame();
  }, 1000);

  moveSwitchTrackTargets(ga);
}

function spawnSwitchTrackTarget(ga) {
  if (!ga) ga = document.getElementById('game-area');
  if (!ga || !isGameRunning) return;

  const sz     = settings.size;
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
    hits++;
  } else {
    points = Math.round(points * 0.4);
    streak = 0;
    bonusText = '✗ WRONG';
    playMiss();
    misses++;
  }

  const streakMult = 1 + Math.min(0.6, Math.floor(streak / 5) * 0.1);
  points = Math.round(points * streakMult);

  score += points; updateHUD();
  if (isPriority && streak % 5 === 0 && streak > 0) playStreak(streak / 5);

  showScorePopup(x, y, (points > 0 ? '+' : '') + points, false);
  if (bonusText) showScorePopup(x, y - 38, bonusText, true);
  if (streak >= 3 && isPriority) showStreakLabel(x, y + 38);
  showHitRing(x, y);

  const sEl = document.getElementById('hud-streak');
  const sCount = document.getElementById('streak-count');
  if (sEl && sCount) {
    if (streak >= 3) { sEl.style.display = 'block'; sCount.textContent = streak; }
    else             { sEl.style.display = 'none'; }
  }

  el.remove();

  setTimeout(() => {
    if (!isGameRunning) return;
    const g = document.getElementById('game-area');
    if (g) {
      spawnSwitchTrackTarget(g);
      assignSwitchTrackPriority();
    }
  }, 150);

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
    const r = settings.size / 2 + 4;

    angle += (Math.random() - 0.5) * 0.055;

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
//  SCORE HISTORY
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
  const entries = (all[histActiveMode] || []).slice().reverse();
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

  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const y = pad.t + gH * (1 - f);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '9px Rajdhani, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxS * f).toLocaleString(), pad.l - 6, y + 3);
  });

  const hexToRgba = (hex, a) => {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  };
  const accentClean = accent.length === 7 ? accent : '#00f5ff';
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + gH);
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

  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(scores[0]));
  entries.forEach((e, i) => { if (i > 0) ctx.lineTo(xOf(i), yOf(e.score)); });
  ctx.strokeStyle = accentClean;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

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

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.font = '9px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  entries.forEach((_, i) => {
    if (n <= 10 || i % Math.ceil(n / 8) === 0)
      ctx.fillText(i + 1, xOf(i), H - 6);
  });

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
//  SHARE CARD
// ═══════════════════════════════════════════════════════════
function shareResult() {
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 600, H = 340;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(0,245,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  const accentHex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00f5ff';

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, W, 3);

  ctx.font      = 'bold 26px Orbitron, monospace';
  ctx.fillStyle = accentHex;
  ctx.textAlign = 'left';
  ctx.fillText('AIMO', 28, 44);

  const modeLabel = (document.getElementById('mode-label-hud')?.textContent || selectedMode).toUpperCase();
  ctx.font      = '11px Rajdhani, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fillText('AIM TRAINER  ·  ' + modeLabel + ' MODE  ·  ' + selectedDuration + 's', 28, 62);

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(28, 72, W - 56, 1);

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

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, cx, cy, colW - 8, 64, 3);
    ctx.fill();

    ctx.font      = 'bold 22px Orbitron, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(s.val, cx + (colW - 8) / 2, cy + 36);

    ctx.font      = '10px Rajdhani, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText(s.label, cx + (colW - 8) / 2, cy + 53);
  });

  ctx.font      = '10px Rajdhani, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.textAlign = 'right';
  ctx.fillText('aimo.gg  ·  ' + new Date().toLocaleDateString(), W - 28, H - 12);

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
//  INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isGameRunning) endGame();
});

window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.addEventListener('mousedown', () => { if (audioCtx && audioCtx.state==='suspended') audioCtx.resume(); }, { once:true });
  initCrosshair();

  const ga = document.getElementById('game-area');
  if (ga) {
    ga.addEventListener('mousedown', e => {
      if (!isGameRunning || selectedMode === 'trace') return;
      missClick(e);
    });
  }

  const cbSelect = document.getElementById('colorblind-select');
  if (cbSelect) {
    cbSelect.value = settings.colorblind || 'none';
    cbSelect.addEventListener('change', (e) => setColorblindMode(e.target.value));
  }
  const hcCheck = document.getElementById('high-contrast');
  if (hcCheck) {
    hcCheck.checked = settings.highContrast || false;
    hcCheck.addEventListener('change', (e) => toggleHighContrast(e.target.checked));
  }
  const rmCheck = document.getElementById('reduced-motion');
  if (rmCheck) {
    rmCheck.checked = settings.reducedMotion || false;
    rmCheck.addEventListener('change', (e) => toggleReducedMotion(e.target.checked));
  }
});
