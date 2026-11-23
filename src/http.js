'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');
const auth = require('./auth');
const util = require('./util');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  const publicDir = path.join(process.cwd(), 'public');
  let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
  // prevent traversal
  if (!filePath.startsWith(publicDir)) { res.writeHead(403); res.end(); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback: index.html
      filePath = path.join(publicDir, 'index.html');
      fs.readFile(filePath, (e, data) => {
        if (e) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (e, data) => {
      if (e) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    });
  });
}

async function handleApi(req, res, pathname) {
  const method = req.method;
  const { safeJson, readBody, parseCookies } = util;

  // Admin login
  if (pathname === '/api/admin/login' && method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { safeJson(res, 400, { error: 'bad json' }); return; }
    const token = auth.login(body.password);
    if (!token) { safeJson(res, 401, { error: 'password salah' }); return; }
    auth.setCookie(res, token);
    safeJson(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/admin/logout' && method === 'POST') {
    const token = auth.getTokenFromReq(req);
    auth.logout(token);
    auth.clearCookie(res);
    safeJson(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/admin/me' && method === 'GET') {
    const token = auth.getTokenFromReq(req);
    safeJson(res, 200, { authed: auth.isValid(token) });
    return;
  }

  // Admin: exams list/create
  if (pathname === '/api/admin/exams' && method === 'GET') {
    if (!auth.requireAdmin(req, res)) return;
    const exams = db.listExams();
    safeJson(res, 200, { exams });
    return;
  }
  if (pathname === '/api/admin/exams' && method === 'POST') {
    if (!auth.requireAdmin(req, res)) return;
    let body; try { body = JSON.parse(await readBody(req)); } catch { safeJson(res, 400, { error: 'bad json' }); return; }
    const title = (body.title || '').trim();
    const form_url = (body.form_url || '').trim();
    if (!title || !form_url) { safeJson(res, 400, { error: 'title dan form_url wajib' }); return; }
    const penalty = Number.isFinite(body.penalty) ? parseInt(body.penalty, 10) : cfg.penaltyDefault;
    const max_violations = Number.isFinite(body.max_violations) ? parseInt(body.max_violations, 10) : cfg.maxViolationsDefault;
    const duration_min = Number.isFinite(body.duration_min) ? parseInt(body.duration_min, 10) : 0;
    const exam = db.createExam({ title, form_url, penalty, max_violations, duration_min });
    safeJson(res, 201, { exam });
    return;
  }

  // /api/admin/exams/:id
  let m = pathname.match(/^\/api\/admin\/exams\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'GET') {
      if (!auth.requireAdmin(req, res)) return;
      const exam = db.getExam(id);
      if (!exam) { safeJson(res, 404, { error: 'not found' }); return; }
      safeJson(res, 200, { exam });
      return;
    }
    if (method === 'PUT') {
      if (!auth.requireAdmin(req, res)) return;
      let body; try { body = JSON.parse(await readBody(req)); } catch { safeJson(res, 400, { error: 'bad json' }); return; }
      const exam = db.updateExam(id, body);
      safeJson(res, 200, { exam });
      return;
    }
    if (method === 'DELETE') {
      if (!auth.requireAdmin(req, res)) return;
      db.deleteExam(id);
      safeJson(res, 200, { ok: true });
      return;
    }
  }

  // sessions list for exam
  m = pathname.match(/^\/api\/admin\/exams\/(\d+)\/sessions$/);
  if (m && method === 'GET') {
    if (!auth.requireAdmin(req, res)) return;
    const sessions = db.listSessions(Number(m[1]));
    safeJson(res, 200, { sessions });
    return;
  }

  // session events
  m = pathname.match(/^\/api\/admin\/sessions\/(\d+)\/events$/);
  if (m && method === 'GET') {
    if (!auth.requireAdmin(req, res)) return;
    const events = db.listEvents(Number(m[1]));
    safeJson(res, 200, { events });
    return;
  }

  // delete session
  m = pathname.match(/^\/api\/admin\/sessions\/(\d+)$/);
  if (m && method === 'DELETE') {
    if (!auth.requireAdmin(req, res)) return;
    db.deleteSession(Number(m[1]));
    safeJson(res, 200, { ok: true });
    return;
  }

  // CSV export
  if (pathname === '/api/admin/export' && method === 'GET') {
    if (!auth.requireAdmin(req, res)) return;
    const url = new URL(req.url, 'http://x');
    const examId = url.searchParams.get('exam_id');
    let rows = [];
    if (examId) rows = db.listSessions(Number(examId));
    else {
      // all exams
      const exams = db.listExams();
      for (const e of exams) rows = rows.concat(db.listSessions(e.id).map(s => ({ ...s, exam_code: e.code, exam_title: e.title })));
    }
    const header = 'exam_code,exam_title,nis,name,kelas,mulai,selesai,pelanggaran,potongan,status,alasan\n';
    const csv = header + rows.map((s) => {
      const exam = db.getExam(s.exam_id);
      return [exam.code, `"${(exam.title||'').replace(/"/g,'""')}"`, s.nis||'', `"${(s.name||'').replace(/"/g,'""')}"`, s.kelas||'', s.started_at, s.ended_at||'', s.violations, s.penalty_total, s.status, s.finish_reason||''].join(',');
    }).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="hasil.csv"' });
    res.end(csv);
    return;
  }

  // Public: exam info by code
  m = pathname.match(/^\/api\/exams\/([A-Za-z0-9]+)$/);
  if (m && method === 'GET') {
    const exam = db.getExam(m[1].toUpperCase());
    if (!exam || !exam.active) { safeJson(res, 404, { error: 'ujian tidak ditemukan / nonaktif' }); return; }
    safeJson(res, 200, { exam: { code: exam.code, title: exam.title, form_url: exam.form_url, penalty: exam.penalty, max_violations: exam.max_violations, duration_min: exam.duration_min } });
    return;
  }

  // Create session
  if (pathname === '/api/sessions' && method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { safeJson(res, 400, { error: 'bad json' }); return; }
    const code = (body.exam_code || '').toUpperCase().trim();
    const exam = db.getExam(code);
    if (!exam || !exam.active) { safeJson(res, 404, { error: 'ujian tidak ditemukan' }); return; }
    const name = (body.name || '').trim();
    if (!name) { safeJson(res, 400, { error: 'nama wajib' }); return; }
    const session = db.createSession({ exam_id: exam.id, nis: body.nis, name, kelas: body.kelas });
    safeJson(res, 201, { session_id: session.id, exam: { code: exam.code, title: exam.title, form_url: exam.form_url, penalty: exam.penalty, max_violations: exam.max_violations, duration_min: exam.duration_min } });
    return;
  }

  // Session violation
  m = pathname.match(/^\/api\/sessions\/(\d+)\/violation$/);
  if (m && method === 'POST') {
    const sid = Number(m[1]);
    const session = db.getSession(sid);
    if (!session || session.status !== 'active') { safeJson(res, 404, { error: 'sesi tidak aktif' }); return; }
    let body; try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    const result = db.addViolation(sid, body.type || 'unknown', body.detail || null);
    // if max reached, abort
    if (result.max_reached) db.abortSession(sid, 'max_violations');
    safeJson(res, 200, { violations: result.violations, penalty_total: result.penalty_total, max_reached: result.max_reached, penalty: result.exam.penalty });
    return;
  }

  // heartbeat
  m = pathname.match(/^\/api\/sessions\/(\d+)\/heartbeat$/);
  if (m && method === 'POST') {
    const sid = Number(m[1]);
    const session = db.getSession(sid);
    if (!session) { safeJson(res, 404, { error: 'not found' }); return; }
    db.heartbeat(sid);
    safeJson(res, 200, { ok: true, status: session.status });
    return;
  }

  // finish
  m = pathname.match(/^\/api\/sessions\/(\d+)\/finish$/);
  if (m && method === 'POST') {
    const sid = Number(m[1]);
    const session = db.getSession(sid);
    if (!session) { safeJson(res, 404, { error: 'not found' }); return; }
    let body; try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    if (session.status === 'active') db.finishSession(sid, body.reason || 'manual');
    const updated = db.getSession(sid);
    safeJson(res, 200, { session: updated });
    return;
  }

  // 404
  safeJson(res, 404, { error: 'not found' });
}

function createHandler() {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
      } else {
        serveStatic(req, res, pathname);
      }
    } catch (err) {
      util.logger.error('handler error: %s', err && err.stack ? err.stack : err);
      if (!res.headersSent) util.safeJson(res, 500, { error: 'server error' });
    }
  };
}

module.exports = { createHandler };
