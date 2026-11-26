'use strict';

const $ = (s) => document.querySelector(s);

let session = null; // { session_id, exam }
let examActive = false;
let violations = 0;
let penaltyTotal = 0;
let violationCooldown = false;
let timerInterval = null;
let heartbeatInterval = null;
let endTime = null;
let audioCtx = null;
let devtoolsInterval = null;
let idleInterval = null;
let lastActivity = Date.now();
let idleOverlayShown = false;
let fsSupportedGlobal = true;
let orientationChanging = false;
const LOCK_KEY = 'proktor_exam_lock';
const SESSION_KEY = 'proktor_session';
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

function api(path, opts = {}) {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
    .then(async (res) => {
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    });
}

function embedUrl(url) {
  try {
    let u = new URL(String(url).replace(/\/preview(\?|$)/, '/viewform$1'));
    if (!u.searchParams.has('embedded')) u.searchParams.set('embedded', 'true');
    return u.toString();
  } catch { return url; }
}

$('#startBtn').addEventListener('click', startExam);
$('#s_code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

async function startExam() {
  const err = $('#startErr');
  err.textContent = '';
  const code = $('#s_code').value.trim();
  const name = $('#s_name').value.trim();
  if (!code || !name) { err.textContent = 'Kode ujian dan nama wajib diisi.'; return; }

  // request fullscreen first (user gesture)
  const fsEl = document.documentElement;
  let fsGranted = false;
  let fsSupported = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  fsSupportedGlobal = fsSupported;
  try {
    if (fsEl.requestFullscreen) { await fsEl.requestFullscreen(); fsGranted = true; }
    else if (fsEl.webkitRequestFullscreen) { fsEl.webkitRequestFullscreen(); fsGranted = true; }
  } catch (e) { fsGranted = false; }

  if (fsSupported && !fsGranted) {
    err.textContent = 'Mode layar penuh ditolak/gagal. Izinkan fullscreen di browser lalu coba lagi.';
    return;
  }
  if (!fsSupported) {
    // iOS Safari: fullscreen API tidak tersedia; lanjutkan dengan peringatan
    console.warn('Fullscreen API tidak didukung (kemungkinan iOS).');
  }
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}

  // create session
  try {
    const data = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        exam_code: code,
        nis: $('#s_nis').value.trim(),
        name,
        kelas: $('#s_kelas').value.trim(),
      }),
    });
    session = data;
    // fullscreen already requested above
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    enterExamView(data.exam, data.session_id, data.started_at, 0, 0);
  } catch (e) {
    err.textContent = 'Gagal memulai: ' + e.message;
    try { document.exitFullscreen(); } catch {}
  }
}

function enterExamView(exam, sessionId, startedAt, vCount, pTotal) {
  session = { session_id: sessionId, exam };
  violations = vCount || 0;
  penaltyTotal = pTotal || 0;
  $('#vCount').textContent = violations;
  $('#vPenalty').textContent = penaltyTotal;

  // multi-tab lock
  const lockVal = localStorage.getItem(LOCK_KEY);
  const now = Date.now();
  if (lockVal) {
    const [sid, ts] = lockVal.split('|');
    if (sid && sid !== String(sessionId) && now - Number(ts) < 60000) {
      try { document.exitFullscreen(); } catch {}
      alert('Ujian sudah berjalan di tab/jendela lain. Tutup tab lain lalu coba lagi.');
      return;
    }
  }
  localStorage.setItem(LOCK_KEY, sessionId + '|' + now);

  examActive = true;
  $('#examTitle').textContent = exam.title;
  $('#startView').style.display = 'none';
  $('#examView').classList.add('active');
  const fsfb = document.getElementById('fsFinishBtn');
  if (fsfb) fsfb.style.display = 'block';
  setTimeout(adjustExamPadding, 50);

  // timer based on started_at
  if (exam.duration_min && exam.duration_min > 0) {
    const startMs = startedAt ? new Date(startedAt).getTime() : Date.now();
    endTime = startMs + exam.duration_min * 60 * 1000;
    if (endTime <= Date.now()) { finishExam('timeout'); return; }
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  } else {
    $('#timer').textContent = 'Tanpa batas';
    endTime = null;
  }

  // heartbeat
  heartbeatInterval = setInterval(() => {
    if (!examActive) return;
    api('/api/sessions/' + session.session_id + '/heartbeat', { method: 'POST', body: '{}' }).catch(() => {});
    try { localStorage.setItem(LOCK_KEY, session.session_id + '|' + Date.now()); } catch {}
  }, 30000);

  // persist session for refresh resume
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      session_id: sessionId,
      exam,
      started_at: startedAt || new Date().toISOString(),
      violations,
      penalty_total: penaltyTotal,
    }));
  } catch {}

  attachDetectors();
  checkOrientation();

  // set iframe src after listener
  const frame = $('#examFrame');
  let iframeLoadCount = 0;
  frame.addEventListener('load', () => {
    if (!examActive) return;
    iframeLoadCount++;
    // (auto-detect disabled per Option A; no-op)
  });
  frame.src = embedUrl(exam.form_url);

  // attempt fullscreen
  requestFsSafe();
}

function requestFsSafe() {
  const fsEl = document.documentElement;
  if (fsEl.requestFullscreen) {
    fsEl.requestFullscreen().then(() => {}).catch(() => { showResumeFsOverlay(); });
  } else if (fsEl.webkitRequestFullscreen) {
    try { fsEl.webkitRequestFullscreen(); } catch (e) { showResumeFsOverlay(); }
  } else {
    showResumeFsOverlay();
  }
}

function showResumeFsOverlay() {
  let ov = document.getElementById('resumeFsOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'resumeFsOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:250;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;color:#fff;text-align:center;padding:20px;';
    ov.innerHTML = '<div><div style="font-size:40px;margin-bottom:8px;">📱</div><div style="font-size:18px;margin-bottom:12px;">Klik untuk kembali ke layar penuh</div><button class="btn success" id="resumeFsBtn2">Lanjutkan (Layar Penuh)</button></div>';
    document.body.appendChild(ov);
    document.getElementById('resumeFsBtn2').addEventListener('click', async () => {
      const fsEl = document.documentElement;
      try {
        if (fsEl.requestFullscreen) await fsEl.requestFullscreen();
        else if (fsEl.webkitRequestFullscreen) fsEl.webkitRequestFullscreen();
      } catch {}
      ov.style.display = 'none';
    });
  } else {
    ov.style.display = 'flex';
  }
}

function beginExam() {
  // handled in startExam -> create session -> enterExamView
}

function updateTimer() {
  if (!endTime) return;
  const remaining = endTime - Date.now();
  if (remaining <= 0) {
    $('#timer').textContent = '00:00';
    finishExam('timeout');
    return;
  }
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  $('#timer').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function attachDetectors() {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('copy', onCopyPaste);
  document.addEventListener('paste', onCopyPaste);
  document.addEventListener('cut', onCopyPaste);
  document.addEventListener('keydown', onKeyDown);

  // multi-tab detection via storage
  window.addEventListener('storage', onStorageChange);

  const isTouch = isMobileDevice();
  // resize detection (mobile included for orientation/keyboard handling)
  window.addEventListener('resize', onResize);
  // orientation change: ignore resize during rotation
  window.addEventListener('orientationchange', onOrientationChange);
  if (window.screen && window.screen.orientation) {
    window.screen.orientation.addEventListener('change', onOrientationChange);
  }

  // activity tracking
  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach((ev) => document.addEventListener(ev, resetActivity, true));

  // devtools heuristic (desktop only; mobile toolbars cause false positives)
  if (!isTouch) devtoolsInterval = setInterval(checkDevtools, 2000);

  // idle check
  idleInterval = setInterval(checkIdle, 5000);
}

function detachDetectors() {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('contextmenu', onContextMenu);
  document.removeEventListener('copy', onCopyPaste);
  document.removeEventListener('paste', onCopyPaste);
  document.removeEventListener('cut', onCopyPaste);
  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('storage', onStorageChange);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('orientationchange', onOrientationChange);
  if (window.screen && window.screen.orientation) {
    window.screen.orientation.removeEventListener('change', onOrientationChange);
  }
  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach((ev) => document.removeEventListener(ev, resetActivity, true));
  if (devtoolsInterval) { clearInterval(devtoolsInterval); devtoolsInterval = null; }
  if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
}

function onFullscreenChange() {
  if (!examActive) return;
  // Hanya berlaku jika browser mendukung Fullscreen API (bukan iOS Safari)
  if (!fsSupportedGlobal) return;
  // Abaikan jika sedang rotasi layar
  if (orientationChanging) return;
  const w = window.innerWidth, h = window.innerHeight;
  // jika dimensi swap (rotasi), abaikan
  if (Math.abs(w - lastH) < 80 && Math.abs(h - lastW) < 80) return;
  if (!document.fullscreenElement) {
    handleViolation('fullscreen_exit', 'Keluar dari mode layar penuh');
  }
}
function onVisibilityChange() {
  if (!examActive) return;
  if (document.hidden) handleViolation('tab_switch', 'Berpindah tab atau minimize');
}
function onContextMenu(e) {
  if (!examActive) return;
  const isTouch = isMobileDevice();
  if (isTouch) return; // hindari false positive di HP
  e.preventDefault();
  handleViolation('right_click', 'Klik kanan');
}
function onCopyPaste(e) {
  if (!examActive) return;
  if (isMobileDevice()) return; // hindari false positive di HP
  e.preventDefault();
  handleViolation('copy_paste', 'Copy/Paste/Cut');
}
function onKeyDown(e) {
  if (!examActive) return;
  const isTouch = isMobileDevice();
  if (isTouch) return; // hindari false positive di HP
  const key = (e.key || '').toUpperCase();
  const blocked = (key === 'F12') ||
    (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(key)) ||
    (e.ctrlKey && ['U', 'S', 'P', 'A'].includes(key)) ||
    (e.metaKey && e.altKey && key === 'I');
  if (blocked) {
    e.preventDefault();
    e.stopPropagation();
    handleViolation('shortcut', 'Pintasan keyboard terlarang (' + e.key + ')');
    return false;
  }
  // Esc is handled by fullscreen exit
}

function playViolationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.15);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.16);
    });
  } catch {}
}

async function handleViolation(type, detail) {
  if (!examActive || violationCooldown) return;
  playViolationSound();
  violationCooldown = true;
  setTimeout(() => { violationCooldown = false; }, 2000);

  let data;
  try {
    data = await api('/api/sessions/' + session.session_id + '/violation', {
      method: 'POST',
      body: JSON.stringify({ type, detail }),
    });
  } catch (e) {
    // still show
    data = { violations: violations + 1, penalty_total: penaltyTotal + session.exam.penalty, max_reached: false, penalty: session.exam.penalty };
  }
  violations = data.violations;
  penaltyTotal = data.penalty_total;
  $('#vCount').textContent = violations;
  $('#vPenalty').textContent = penaltyTotal;

  // show overlay
  $('#vMsg').textContent = detail + '. Segera kembali ke layar penuh.';
  $('#vNum').textContent = violations;
  $('#vTotal').textContent = penaltyTotal;
  $('#violationOverlay').classList.add('active');

  if (data.max_reached) {
    // auto finish
    setTimeout(() => finishExam('max_violations'), 1500);
  }
}

function onStorageChange(e) {
  if (!examActive) return;
  if (e.key === LOCK_KEY && e.newValue) {
    const [sid] = e.newValue.split('|');
    if (sid && sid !== String(session.session_id)) {
      handleViolation('multi_tab', 'Ujian dibuka di tab/jendela lain');
    }
  }
}
let lastW = window.innerWidth, lastH = window.innerHeight;
function onOrientationChange() {
  orientationChanging = true;
  setTimeout(() => {
    orientationChanging = false;
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    // coba pulihkan fullscreen jika keluar karena rotasi
    if (fsSupportedGlobal && !document.fullscreenElement) {
      const fsEl = document.documentElement;
      try {
        if (fsEl.requestFullscreen) fsEl.requestFullscreen().catch(() => {});
        else if (fsEl.webkitRequestFullscreen) fsEl.webkitRequestFullscreen();
      } catch (e) {}
    }
    checkOrientation();
  }, 2000);
  checkOrientation();
}

function checkOrientation() {
  const ov = document.getElementById('orientationOverlay');
  if (!ov) return;
  if (!examActive) { ov.style.display = 'none'; return; }
  const landscape = window.innerWidth > window.innerHeight;
  ov.style.display = landscape ? 'flex' : 'none';
}

function adjustExamPadding() {
  const tb = document.querySelector('.topbar-exam');
  const ev = document.getElementById('examView');
  if (tb && ev) ev.style.paddingTop = (tb.offsetHeight + 8) + 'px';
}
function onResize() {
  if (!examActive) return;
  const w = window.innerWidth, h = window.innerHeight;
  // Abaikan rotasi layar (portrait <-> landscape)
  if (orientationChanging) { lastW = w; lastH = h; return; }
  if (Math.abs(w - lastH) < 80 && Math.abs(h - lastW) < 80) { lastW = w; lastH = h; return; }
  // Abaikan perubahan tinggi saja (keyboard virtual di HP)
  const widthChanged = Math.abs(w - lastW) > 120;
  const heightChanged = Math.abs(h - lastH) > 120;
  if (!widthChanged && heightChanged) { lastW = w; lastH = h; return; }
  if (fsSupportedGlobal && !document.fullscreenElement) {
    handleViolation('resize', 'Jendela tidak dalam mode layar penuh');
  } else if (widthChanged) {
    handleViolation('resize', 'Perubahan ukuran layar terdeteksi');
  }
  lastW = w; lastH = h;
  checkOrientation();
  adjustExamPadding();
}
function resetActivity() { lastActivity = Date.now(); if (idleOverlayShown) hideIdleOverlay(); }
function checkDevtools() {
  if (!examActive) return;
  const threshold = 200;
  if (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold) {
    handleViolation('devtools', 'DevTools terdeteksi terbuka');
  }
}
function showIdleOverlay() {
  idleOverlayShown = true;
  const el = document.getElementById('idleOverlay');
  if (el) el.style.display = 'flex';
}
function hideIdleOverlay() {
  idleOverlayShown = false;
  const el = document.getElementById('idleOverlay');
  if (el) el.style.display = 'none';
  lastActivity = Date.now();
}
function checkIdle() {
  if (!examActive) return;
  if (Date.now() - lastActivity > 120000 && !idleOverlayShown) showIdleOverlay();
}

$('#idleOkBtn').addEventListener('click', () => { hideIdleOverlay(); });

$('#resumeFsBtn').addEventListener('click', async () => {
  try {
    const fsEl = document.documentElement;
    if (fsEl.requestFullscreen) await fsEl.requestFullscreen();
    else if (fsEl.webkitRequestFullscreen) fsEl.webkitRequestFullscreen();
  } catch {}
  $('#violationOverlay').classList.remove('active');
});

function showConfirm(message, onYes) {
  const modal = document.getElementById('confirmModal');
  const msg = document.getElementById('confirmMsg');
  if (msg) msg.textContent = message;
  if (modal) modal.style.display = 'flex';
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  const cleanup = () => {
    if (modal) modal.style.display = 'none';
    if (okBtn) okBtn.onclick = null;
    if (cancelBtn) cancelBtn.onclick = null;
  };
  if (okBtn) okBtn.onclick = () => { cleanup(); onYes(); };
  if (cancelBtn) cancelBtn.onclick = () => { cleanup(); };
}

const finishBtn = document.getElementById('finishBtn');
if (finishBtn) {
  finishBtn.addEventListener('click', () => {
    showConfirm('Selesai mengerjakan ujian?', () => finishExam('manual'));
  });
}

const fsFinishBtn = document.getElementById('fsFinishBtn');
if (fsFinishBtn) {
  fsFinishBtn.addEventListener('click', () => {
    showConfirm('Selesai mengerjakan ujian?', () => finishExam('manual'));
  });
}

function releaseLock(sessionId) {
  try {
    const existing = localStorage.getItem(LOCK_KEY);
    if (existing && existing.startsWith(sessionId + '|')) localStorage.removeItem(LOCK_KEY);
  } catch {}
}

async function finishExam(reason) {
  if (!examActive) return;
  examActive = false;
  detachDetectors();
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  hideIdleOverlay();
  const oov = document.getElementById('orientationOverlay');
  if (oov) oov.style.display = 'none';
  try { releaseLock(session.session_id); } catch {}
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  try { await api('/api/sessions/' + session.session_id + '/finish', { method: 'POST', body: JSON.stringify({ reason }) }); } catch {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  $('#violationOverlay').classList.remove('active');
  $('#examView').classList.remove('active');
  const fsfb = document.getElementById('fsFinishBtn');
  if (fsfb) fsfb.style.display = 'none';
  $('#resultView').classList.add('active');
  $('#rViolations').textContent = violations;
  $('#rPenalty').textContent = penaltyTotal;
  const reasonText = reason === 'timeout' ? 'Waktu habis.' : (reason === 'max_violations' ? 'Terlalu banyak pelanggaran — ujian dihentikan otomatis.' : 'Ujian diselesaikan.');
  $('#resultMsg').textContent = reasonText;
}

async function tryResume() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!saved || !saved.session_id) return;
  try {
    const data = await api('/api/sessions/' + saved.session_id);
    if (data.session && data.session.status === 'active') {
      enterExamView(data.exam, data.session.id, data.session.started_at, data.session.violations, data.session.penalty_total);
      return;
    }
    // finished/aborted
    sessionStorage.removeItem(SESSION_KEY);
    showResultScreen(data.session);
  } catch (e) {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

function showResultScreen(sess) {
  $('#startView').style.display = 'none';
  $('#examView').classList.remove('active');
  $('#resultView').classList.add('active');
  $('#rViolations').textContent = sess ? sess.violations : 0;
  $('#rPenalty').textContent = sess ? sess.penalty_total : 0;
  const msg = sess && sess.status === 'aborted' ? 'Ujian dihentikan otomatis.' : 'Ujian selesai.';
  $('#resultMsg').textContent = msg;
}

// iOS detection note
(function () {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const note = document.getElementById('iosNote');
  if (isIOS && note) {
    note.textContent = 'Pengguna iPhone/iPad: Safari tidak mendukung layar penuh penuh. Untuk pengalaman terbaik, buka menu Share → "Add to Home Screen", lalu jalankan dari ikon Home Screen (mode mandiri).';
  }
})();

// prevent accidental navigation
window.addEventListener('beforeunload', (e) => {
  if (examActive) { e.preventDefault(); e.returnValue = ''; }
});

// auto-resume if session saved
tryResume();
