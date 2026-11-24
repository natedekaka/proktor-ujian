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
let submitting = false;
const LOCK_KEY = 'proktor_exam_lock';

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
    const u = new URL(url);
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
    violations = 0; penaltyTotal = 0;
    beginExam();
  } catch (e) {
    err.textContent = 'Gagal memulai: ' + e.message;
    try { document.exitFullscreen(); } catch {}
  }
}

function beginExam() {
  // multi-tab lock
  const lockVal = localStorage.getItem(LOCK_KEY);
  const now = Date.now();
  if (lockVal) {
    const [sid, ts] = lockVal.split('|');
    if (sid && sid !== String(session.session_id) && now - Number(ts) < 60000) {
      try { document.exitFullscreen(); } catch {}
      alert('Ujian sudah berjalan di tab/jendela lain. Tutup tab lain lalu coba lagi.');
      return;
    }
  }
  localStorage.setItem(LOCK_KEY, session.session_id + '|' + now);

  examActive = true;
  const exam = session.exam;
  $('#examTitle').textContent = exam.title;
  $('#startView').style.display = 'none';

  const fbtn = document.getElementById('floatingFinishBtn');
  if (fbtn) fbtn.style.display = 'block';

  // Deteksi submit Google Form: load kedua pada iframe = halaman konfirmasi
  let iframeLoadCount = 0;
  const frame = $('#examFrame');
  frame.addEventListener('load', () => {
    if (!examActive) return;
    iframeLoadCount++;
    if (iframeLoadCount < 2) return;
    submitting = true;
    violationCooldown = true;
    const ov = document.getElementById('submittingOverlay');
    if (ov) ov.style.display = 'flex';
    // cegah klik "Lihat akurasi" dengan menutupi iframe
    frame.style.pointerEvents = 'none';
    setTimeout(() => {
      if (examActive) finishExam('submitted');
    }, 1000);
  });
  // pasang src SETELAH listener agar load pertama tercatat
  frame.src = embedUrl(exam.form_url);
  $('#examView').classList.add('active');

  // timer
  if (exam.duration_min && exam.duration_min > 0) {
    endTime = Date.now() + exam.duration_min * 60 * 1000;
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  } else {
    $('#timer').textContent = 'Tanpa batas';
  }

  // heartbeat
  heartbeatInterval = setInterval(() => {
    if (!examActive) return;
    api('/api/sessions/' + session.session_id + '/heartbeat', { method: 'POST', body: '{}' }).catch(() => {});
    try { localStorage.setItem(LOCK_KEY, session.session_id + '|' + Date.now()); } catch {}
  }, 30000);

  attachDetectors();
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

  // resize detection
  window.addEventListener('resize', onResize);

  // activity tracking
  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach((ev) => document.addEventListener(ev, resetActivity, true));

  // devtools heuristic
  devtoolsInterval = setInterval(checkDevtools, 2000);

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
  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach((ev) => document.removeEventListener(ev, resetActivity, true));
  if (devtoolsInterval) { clearInterval(devtoolsInterval); devtoolsInterval = null; }
  if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
}

function onFullscreenChange() {
  if (!examActive) return;
  // Hanya berlaku jika browser mendukung Fullscreen API (bukan iOS Safari)
  if (!fsSupportedGlobal) return;
  if (!document.fullscreenElement) {
    handleViolation('fullscreen_exit', 'Keluar dari mode layar penuh');
  }
}
function onVisibilityChange() {
  if (!examActive) return;
  if (submitting) return; // abaikan saat submit (Google Form membuka skor)
  if (document.hidden) handleViolation('tab_switch', 'Berpindah tab atau minimize');
}
function onContextMenu(e) {
  if (!examActive) return;
  e.preventDefault();
  handleViolation('right_click', 'Klik kanan');
}
function onCopyPaste(e) {
  if (!examActive) return;
  e.preventDefault();
  handleViolation('copy_paste', 'Copy/Paste/Cut');
}
function onKeyDown(e) {
  if (!examActive) return;
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
  if (!examActive || violationCooldown || submitting) return;
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
function onResize() {
  if (!examActive) return;
  const w = window.innerWidth, h = window.innerHeight;
  if (fsSupportedGlobal && !document.fullscreenElement) {
    handleViolation('resize', 'Jendela tidak dalam mode layar penuh');
  } else if (Math.abs(w - lastW) > 120 || Math.abs(h - lastH) > 120) {
    handleViolation('resize', 'Perubahan ukuran layar terdeteksi');
  }
  lastW = w; lastH = h;
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

$('#finishBtn').addEventListener('click', () => {
  if (!confirm('Selesai mengerjakan ujian?')) return;
  finishExam('manual');
});

function doSubmitFinish() {
  submitting = true;
  violationCooldown = true;
  const ov = document.getElementById('submittingOverlay');
  if (ov) ov.style.display = 'flex';
  try { $('#examFrame').style.pointerEvents = 'none'; } catch {}
  setTimeout(() => {
    if (examActive) finishExam('submitted');
  }, 300);
}

$('#submitFinishBtn').addEventListener('click', doSubmitFinish);
const floatingBtn = document.getElementById('floatingFinishBtn');
if (floatingBtn) {
  floatingBtn.addEventListener('click', doSubmitFinish);
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
  const sov = document.getElementById('submittingOverlay');
  if (sov) sov.style.display = 'none';
  const fbtn = document.getElementById('floatingFinishBtn');
  if (fbtn) fbtn.style.display = 'none';
  try { $('#examFrame').style.pointerEvents = ''; } catch {}
  try { releaseLock(session.session_id); } catch {}
  try { await api('/api/sessions/' + session.session_id + '/finish', { method: 'POST', body: JSON.stringify({ reason }) }); } catch {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  $('#violationOverlay').classList.remove('active');
  $('#examView').classList.remove('active');
  $('#resultView').classList.add('active');
  $('#rViolations').textContent = violations;
  $('#rPenalty').textContent = penaltyTotal;
  const reasonText = reason === 'timeout' ? 'Waktu habis.' : (reason === 'max_violations' ? 'Terlalu banyak pelanggaran — ujian dihentikan otomatis.' : (reason === 'submitted' ? 'Jawaban terkirim ke Google Form. Ujian selesai.' : 'Ujian diselesaikan.'));
  $('#resultMsg').textContent = reasonText;
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
