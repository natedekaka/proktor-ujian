'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let exams = [];
let examLevelFilter = 'Semua';
let examStatusFilter = 'Semua';
let examSearch = '';
let examSortKey = 'id';
let examSortDir = 'desc';
let examPageSize = 10;
let examPage = 1;

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

  // filter
  const q = examSearch.trim().toLowerCase();
  let filtered = exams.filter((e) => {
    if (examLevelFilter !== 'Semua' && e.level !== examLevelFilter) return false;
    if (examStatusFilter === 'Aktif' && !e.active) return false;
    if (examStatusFilter === 'Nonaktif' && e.active) return false;
    if (q && !String(e.title).toLowerCase().includes(q) && !String(e.code).toLowerCase().includes(q)) return false;
    return true;
  });

  // sort
  filtered.sort((a, b) => {
    let va, vb;
    if (examSortKey === 'active') { va = a.active ? 1 : 0; vb = b.active ? 1 : 0; }
    else { va = a[examSortKey]; vb = b[examSortKey]; }
    if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
    if (va < vb) return examSortDir === 'asc' ? -1 : 1;
    if (va > vb) return examSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // pagination
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / examPageSize));
  if (examPage > totalPages) examPage = totalPages;
  if (examPage < 1) examPage = 1;
  const startIdx = (examPage - 1) * examPageSize;
  const pageItems = filtered.slice(startIdx, startIdx + examPageSize);

  const sortIcon = (key) => examSortKey === key ? (examSortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const rowsHtml = pageItems.length ? pageItems.map((e) => `
        <tr>
          <td><b>${e.code}</b></td>
          <td><span class="badge">${escapeHtml(e.level || 'Semua')}</span></td>
          <td>${escapeHtml(e.title)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(e.form_url)}">${escapeHtml(e.form_url)}</td>
          <td>${e.duration_min ? e.duration_min + ' mnt' : 'Bebas'}</td>
          <td>-${e.penalty}</td>
          <td>${e.max_violations}</td>
          <td><span class="badge ${e.active ? 'success' : 'danger'}">${e.active ? 'Aktif' : 'Nonaktif'}</span></td>
          <td style="white-space:nowrap;">
            <button class="btn secondary" style="padding:4px 8px;font-size:12px;" data-toggle="${e.id}" data-active="${e.active}">${e.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            <button class="btn secondary" style="padding:4px 8px;font-size:12px;" data-edit="${e.id}">Edit</button>
            <button class="btn secondary" style="padding:4px 8px;font-size:12px;" data-view="${e.id}">Hasil</button>
            <button class="btn danger" style="padding:4px 8px;font-size:12px;" data-del="${e.id}">Hapus</button>
          </td>
        </tr>
      `).join('') : '<tr><td colspan="9" class="muted" style="text-align:center;">Tidak ada ujian sesuai filter.</td></tr>';

  el.innerHTML = `
    <div class="row mb" style="align-items:center;gap:10px;flex-wrap:wrap;">
      <input id="examSearch" placeholder="Cari judul/kode..." value="${escapeHtml(examSearch)}" style="max-width:220px;">
      <label style="margin:0;">Tingkat:</label>
      <select id="examLevelFilter" style="width:auto;">
        <option value="Semua"${examLevelFilter === 'Semua' ? ' selected' : ''}>Semua</option>
        <option value="X"${examLevelFilter === 'X' ? ' selected' : ''}>Kelas X</option>
        <option value="XI"${examLevelFilter === 'XI' ? ' selected' : ''}>Kelas XI</option>
        <option value="XII"${examLevelFilter === 'XII' ? ' selected' : ''}>Kelas XII</option>
      </select>
      <label style="margin:0;">Status:</label>
      <select id="examStatusFilter" style="width:auto;">
        <option value="Semua"${examStatusFilter === 'Semua' ? ' selected' : ''}>Semua</option>
        <option value="Aktif"${examStatusFilter === 'Aktif' ? ' selected' : ''}>Aktif</option>
        <option value="Nonaktif"${examStatusFilter === 'Nonaktif' ? ' selected' : ''}>Nonaktif</option>
      </select>
      <label style="margin:0;">Per hal:</label>
      <select id="examPageSize" style="width:auto;">
        ${[10,25,50].map(n => '<option value="' + n + '"' + (examPageSize===n ? ' selected' : '') + '>' + n + '</option>').join('')}
      </select>
      <span class="muted" style="margin-left:auto;">Menampilkan ${pageItems.length} dari ${total} ujian</span>
    </div>
    <div style="overflow-x:auto;">
    <table class="table" style="min-width:1080px;">
      <thead><tr>
        <th data-sort="code" style="cursor:pointer;">Kode${sortIcon('code')}</th>
        <th data-sort="level" style="cursor:pointer;">Tingkat${sortIcon('level')}</th>
        <th data-sort="title" style="cursor:pointer;">Judul Ujian${sortIcon('title')}</th>
        <th>Link Google Form</th>
        <th data-sort="duration_min" style="cursor:pointer;">Durasi${sortIcon('duration_min')}</th>
        <th data-sort="penalty" style="cursor:pointer;">Penalti${sortIcon('penalty')}</th>
        <th data-sort="max_violations" style="cursor:pointer;">Maks${sortIcon('max_violations')}</th>
        <th data-sort="active" style="cursor:pointer;">Status${sortIcon('active')}</th>
        <th>Aksi</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody></table></div>
    <div class="row mt" style="align-items:center;justify-content:space-between;">
      <button class="btn secondary" id="examPrevPage" ${examPage<=1?'disabled':''}>◀ Prev</button>
      <span class="muted">Halaman ${examPage} / ${totalPages}</span>
      <button class="btn secondary" id="examNextPage" ${examPage>=totalPages?'disabled':''}>Next ▶</button>
    </div>`;

  // events
  const searchInput = document.getElementById('examSearch');
  if (searchInput) {
    searchInput.oninput = () => { examSearch = searchInput.value; examPage = 1; renderExams(); };
    // keep focus
    setTimeout(() => { searchInput.focus(); const v = searchInput.value; searchInput.value = ''; searchInput.value = v; }, 0);
  }
  const levelSel = document.getElementById('examLevelFilter');
  if (levelSel) levelSel.onchange = () => { examLevelFilter = levelSel.value; examPage = 1; renderExams(); };
  const statusSel = document.getElementById('examStatusFilter');
  if (statusSel) statusSel.onchange = () => { examStatusFilter = statusSel.value; examPage = 1; renderExams(); };
  const sizeSel = document.getElementById('examPageSize');
  if (sizeSel) sizeSel.onchange = () => { examPageSize = parseInt(sizeSel.value, 10); examPage = 1; renderExams(); };
  const prevBtn = document.getElementById('examPrevPage');
  if (prevBtn) prevBtn.onclick = () => { if (examPage > 1) { examPage--; renderExams(); } };
  const nextBtn = document.getElementById('examNextPage');
  if (nextBtn) nextBtn.onclick = () => { if (examPage < totalPages) { examPage++; renderExams(); } };
  el.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (examSortKey === key) examSortDir = examSortDir === 'asc' ? 'desc' : 'asc';
      else { examSortKey = key; examSortDir = 'asc'; }
      renderExams();
    });
  });
  // re-bind action buttons
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.toggle; const active = b.dataset.active === '1' ? 0 : 1;
    await api('/api/admin/exams/' + id, { method: 'PUT', body: JSON.stringify({ active }) });
    loadExams();
  }));
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
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
    $('#e_level').value = exam.level || 'Semua';
    $('#e_active').value = exam.active ? '1' : '0';
    $('#editMsg').textContent = '';
    $('#editModal').classList.remove('hidden');
  }));
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
    $('#e_level').value = exam.level || 'Semua';
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
        level: $('#c_level').value,
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
        level: $('#e_level').value,
        active: parseInt($('#e_active').value, 10),
      }),
    });
    $('#editMsg').textContent = 'Tersimpan.';
    setTimeout(() => $('#editModal').classList.add('hidden'), 600);
    loadExams();
  } catch (e) { $('#editMsg').textContent = 'Error: ' + e.message; }
});

checkAuth().catch(() => showLogin());
