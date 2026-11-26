'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');
const { logger } = require('./util');

let db;

function init() {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  db = new DatabaseSync(cfg.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate();
  logger.info('DB siap: %s', cfg.dbPath);
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      form_url TEXT NOT NULL,
      penalty INTEGER NOT NULL DEFAULT 5,
      max_violations INTEGER NOT NULL DEFAULT 10,
      duration_min INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      level TEXT NOT NULL DEFAULT 'Semua',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      nis TEXT,
      name TEXT NOT NULL,
      kelas TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      violations INTEGER NOT NULL DEFAULT 0,
      penalty_total INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      finish_reason TEXT,
      FOREIGN KEY (exam_id) REFERENCES exams(id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_exam ON sessions(exam_id);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  `);
  // migrasi: tambah kolom level jika belum ada
  try {
    const cols = db.prepare('PRAGMA table_info(exams)').all().map((c) => c.name);
    if (!cols.includes('level')) {
      db.exec("ALTER TABLE exams ADD COLUMN level TEXT NOT NULL DEFAULT 'Semua'");
    }
  } catch (e) { /* ignore */ }
}

function getDb() { if (!db) throw new Error('DB belum init'); return db; }

// Exams
function createExam({ title, form_url, penalty, max_violations, duration_min, level }) {
  const { randomCode, nowIso } = require('./util');
  let code;
  // ensure unique
  for (let i = 0; i < 10; i++) {
    const c = randomCode(6);
    const exists = getDb().prepare('SELECT 1 FROM exams WHERE code=?').get(c);
    if (!exists) { code = c; break; }
  }
  if (!code) throw new Error('gagal generate code');
  const lvl = (level || 'Semua').trim() || 'Semua';
  const stmt = getDb().prepare(
    'INSERT INTO exams (code,title,form_url,penalty,max_violations,duration_min,active,level,created_at) VALUES (?,?,?,?,?,?,1,?,?)'
  );
  const info = stmt.run(code, title, form_url, penalty, max_violations, duration_min, lvl, nowIso());
  return getExam(info.lastInsertRowid);
}

function getExam(idOrCode) {
  if (typeof idOrCode === 'number' || /^\d+$/.test(String(idOrCode))) {
    return getDb().prepare('SELECT * FROM exams WHERE id=?').get(Number(idOrCode));
  }
  return getDb().prepare('SELECT * FROM exams WHERE code=?').get(String(idOrCode));
}

function listExams() {
  return getDb().prepare('SELECT * FROM exams ORDER BY id DESC').all();
}

function updateExam(id, fields) {
  const allowed = ['title', 'form_url', 'penalty', 'max_violations', 'duration_min', 'active', 'level'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k}=?`); vals.push(fields[k]); }
  }
  if (!sets.length) return getExam(id);
  vals.push(id);
  getDb().prepare(`UPDATE exams SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return getExam(id);
}

function deleteExam(id) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const sessions = db.prepare('SELECT id FROM sessions WHERE exam_id=?').all(id);
    for (const s of sessions) {
      db.prepare('DELETE FROM events WHERE session_id=?').run(s.id);
    }
    db.prepare('DELETE FROM sessions WHERE exam_id=?').run(id);
    db.prepare('DELETE FROM exams WHERE id=?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Sessions
function createSession({ exam_id, nis, name, kelas }) {
  const { nowIso } = require('./util');
  const stmt = getDb().prepare(
    'INSERT INTO sessions (exam_id,nis,name,kelas,started_at,status) VALUES (?,?,?,?,?,?)'
  );
  const info = stmt.run(exam_id, nis || null, name, kelas || null, nowIso(), 'active');
  return getSession(info.lastInsertRowid);
}

function getSession(id) {
  return getDb().prepare('SELECT * FROM sessions WHERE id=?').get(Number(id));
}

function listSessions(exam_id) {
  return getDb().prepare('SELECT * FROM sessions WHERE exam_id=? ORDER BY id DESC').all(exam_id);
}

function addViolation(session_id, type, detail) {
  const { nowIso } = require('./util');
  getDb().prepare('INSERT INTO events (session_id,type,detail,created_at) VALUES (?,?,?,?)').run(session_id, type, detail || null, nowIso());
  const s = getSession(session_id);
  const exam = getExam(s.exam_id);
  const newViolations = s.violations + 1;
  const penaltyTotal = newViolations * exam.penalty;
  getDb().prepare('UPDATE sessions SET violations=?, penalty_total=? WHERE id=?').run(newViolations, penaltyTotal, session_id);
  const maxReached = newViolations >= exam.max_violations;
  return { violations: newViolations, penalty_total: penaltyTotal, max_reached: maxReached, exam };
}

function finishSession(id, reason) {
  const { nowIso } = require('./util');
  getDb().prepare('UPDATE sessions SET status=?, ended_at=?, finish_reason=? WHERE id=?')
    .run('completed', nowIso(), reason || 'manual', id);
  return getSession(id);
}

function abortSession(id, reason) {
  const { nowIso } = require('./util');
  getDb().prepare('UPDATE sessions SET status=?, ended_at=?, finish_reason=? WHERE id=?')
    .run('aborted', nowIso(), reason || 'max_violations', id);
  return getSession(id);
}

function listEvents(session_id) {
  return getDb().prepare('SELECT * FROM events WHERE session_id=? ORDER BY id ASC').all(session_id);
}

function deleteSession(id) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM events WHERE session_id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function heartbeat(session_id) {
  // no-op column; could add last_seen. Keep minimal.
  return getSession(session_id);
}

module.exports = {
  init, getDb,
  createExam, getExam, listExams, updateExam, deleteExam,
  createSession, getSession, listSessions, addViolation, finishSession, abortSession, listEvents, heartbeat, deleteSession,
};
