'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let exams = [];

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function checkAuth() {
  const d = await api('/api/admin/me');
  if (d.authed) showDash(); else showLogin();
}

function showLogin() { $('#loginView').classList.remove('hidden'); $('#dashView').classList.add('hidden'); }
function showDash() { $('#loginView').classList.add('hidden'); $('#dashView').classList.remove('hidden'); loadExams(); }

$('#loginBtn').addEventListener('click', async () => {
  $('#loginErr').textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    showDash();
  } catch (e) { $('#loginErr').textContent = e.message; }
});
$('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginBtn').click(); });

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

// Tabs
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  const tab = t.dataset.tab;
  ['exams','create','results'].forEach((n) => {
    const el = document.getElementById('tab-' + n);
    if (el) el.classList.toggle('hidden', n !== tab);
  });
  if (tab === 'results') populateExamSelect();
}));

async function loadExams() {
  const d = await api('/api/admin/exams');
  exams = d.exams || [];
  renderExams();
  populateExamSelect();
}

function renderExams() {
  const el = $('#examList');
  if (!exams.length) { el.innerHTML = '<p class="muted">Belum ada ujian.</p>'; return; }
  el.innerHTML = exams.map((e) => `
    <div class="exam-row">
      <div>
        <strong>${escapeHtml(e.title)}</strong>
        <div class="muted">Kode: <b>${e.code}</b> · ${e.duration_min ? e.duration_min + ' menit' : 'tanpa batas'} · -${e.penalty}/pelanggaran · maks ${e.max_violations}</div>
        <div class="muted" style="font-size:12px;">${escapeHtml(e.form_url)}</div>
      </div>
      <div class="row" style="align-items:center;">
        <span class="badge ${e.active ? 'success' : 'danger'}">${e.active ? 'Aktif' : 'Nonaktif'}</span>
        <button class="btn secondary" data-toggle="${e.id}" data-active="${e.active}">${e.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
        <button class="btn secondary" data-edit="${e.id}">Edit</button>
        <button class="btn secondary" data-view="${e.id}">Hasil</button>
        <button class="btn danger" data-del="${e.id}">Hapus</button>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.toggle; const active = b.dataset.active === '1' ? 0 : 1;
    await api('/api/admin/exams/' + id, { method: 'PUT', body: JSON.stringify({ active }) });
    loadExams();
  }));
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
    // switch to results tab and select
    $$('.tab').forEach((x) => x.classList.remove('active'));
    const t = $$('.tab').find((x) => x.dataset.tab === 'results'); t.classList.add('active');
    ['exams','create','results'].forEach((n) => document.getElementById('tab-'+n).classList.toggle('hidden', n !== 'results'));
    $('#res_exam').value = b.dataset.view;
    loadSessions();
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Hapus permanen ujian ini beserta semua data sesinya?')) return;
    await api('/api/admin/exams/' + b.dataset.del, { method: 'DELETE' });
    loadExams();
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const exam = exams.find((x) => String(x.id) === String(b.dataset.edit));
    if (!exam) return;
    $('#e_id').value = exam.id;
    $('#e_title').value = exam.title;
    $('#e_form_url').value = exam.form_url;
    $('#e_duration').value = exam.duration_min;
    $('#e_penalty').value = exam.penalty;
    $('#e_maxv').value = exam.max_violations;
    $('#e_active').value = exam.active ? '1' : '0';
    $('#editMsg').textContent = '';
    $('#editModal').classList.remove('hidden');
  }));
}

function populateExamSelect() {
  const sel = $('#res_exam');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)} (${e.code})</option>`).join('');
  if (cur) sel.value = cur;
  sel.onchange = loadSessions;
  if (exams.length) loadSessions();
}

async function loadSessions() {
  const id = $('#res_exam').value;
  if (!id) return;
  const d = await api('/api/admin/exams/' + id + '/sessions');
  const sessions = d.sessions || [];
  const el = $('#sessionList');
  if (!sessions.length) { el.innerHTML = '<p class="muted">Belum ada sesi.</p>'; return; }
  el.innerHTML = `<table class="table"><thead><tr>
    <th>NIS</th><th>Nama</th><th>Kelas</th><th>Mulai</th><th>Selesai</th><th>Pelanggaran</th><th>Potongan</th><th>Status</th><th></th>
  </tr></thead><tbody>` + sessions.map((s) => `
    <tr>
      <td>${escapeHtml(s.nis || '-')}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.kelas || '-')}</td>
      <td>${fmtTime(s.started_at)}</td>
      <td>${s.ended_at ? fmtTime(s.ended_at) : '-'}</td>
      <td><span class="badge ${s.violations > 0 ? 'danger' : ''}">${s.violations}</span></td>
      <td>${s.penalty_total}</td>
      <td><span class="badge ${s.status === 'completed' ? 'success' : (s.status === 'aborted' ? 'danger' : 'warn')}">${s.status}</span></td>
      <td>
        <button class="btn secondary" data-events="${s.id}">Detail</button>
        <button class="btn danger" data-delsession="${s.id}">Hapus</button>
      </td>
    </tr>
  `).join('') + `</tbody></table>`;
  el.querySelectorAll('[data-events]').forEach((b) => b.addEventListener('click', async () => {
    const d = await api('/api/admin/sessions/' + b.dataset.events + '/events');
    const evs = d.events || [];
    $('#eventDetail').innerHTML = '<h4>Timeline Pelanggaran</h4>' + (evs.length ? evs.map((e) => `<div class="event-row"><b>${escapeHtml(e.type)}</b> — ${escapeHtml(e.detail || '')} <span class="muted">(${fmtTime(e.created_at)})</span></div>`).join('') : '<p class="muted">Tidak ada pelanggaran.</p>');
  }));
  el.querySelectorAll('[data-delsession]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Hapus sesi siswa ini beserta data pelanggarannya?')) return;
    await api('/api/admin/sessions/' + b.dataset.delsession, { method: 'DELETE' });
    loadSessions();
  }));
}

$('#createBtn').addEventListener('click', async () => {
  $('#createMsg').textContent = '';
  try {
    const exam = await api('/api/admin/exams', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#c_title').value.trim(),
        form_url: $('#c_form_url').value.trim(),
        duration_min: parseInt($('#c_duration').value || '0', 10),
        penalty: parseInt($('#c_penalty').value || '5', 10),
        max_violations: parseInt($('#c_maxv').value || '10', 10),
      }),
    });
    $('#createMsg').textContent = 'Ujian dibuat. Kode: ' + exam.exam.code;
    $('#c_title').value = ''; $('#c_form_url').value = '';
    loadExams();
  } catch (e) { $('#createMsg').textContent = 'Error: ' + e.message; }
});

$('#exportBtn').addEventListener('click', () => {
  const id = $('#res_exam').value;
  window.open('/api/admin/export' + (id ? '?exam_id=' + id : ''), '_blank');
});

function fmtTime(iso) { try { return new Date(iso).toLocaleString('id-ID'); } catch { return iso; } }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('#cancelEditBtn').addEventListener('click', () => $('#editModal').classList.add('hidden'));
$('#saveEditBtn').addEventListener('click', async () => {
  const id = $('#e_id').value;
  $('#editMsg').textContent = '';
  try {
    await api('/api/admin/exams/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        title: $('#e_title').value.trim(),
        form_url: $('#e_form_url').value.trim(),
        duration_min: parseInt($('#e_duration').value || '0', 10),
        penalty: parseInt($('#e_penalty').value || '5', 10),
        max_violations: parseInt($('#e_maxv').value || '10', 10),
        active: parseInt($('#e_active').value, 10),
      }),
    });
    $('#editMsg').textContent = 'Tersimpan.';
    setTimeout(() => $('#editModal').classList.add('hidden'), 600);
    loadExams();
  } catch (e) { $('#editMsg').textContent = 'Error: ' + e.message; }
});

checkAuth().catch(() => showLogin());
