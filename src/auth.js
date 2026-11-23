'use strict';

const crypto = require('crypto');
const cfg = require('./config');
const { randomToken, nowIso, parseCookies } = require('./util');

// in-memory admin sessions
const sessions = new Map(); // token -> {created}

function login(password) {
  // timing-safe compare
  const a = Buffer.from(password || '');
  const b = Buffer.from(cfg.adminPassword);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  const token = randomToken();
  sessions.set(token, { created: Date.now() });
  return token;
}

function isValid(token) {
  if (!token || !sessions.has(token)) return false;
  const s = sessions.get(token);
  const maxAge = cfg.sessionHours * 3600 * 1000;
  if (Date.now() - s.created > maxAge) { sessions.delete(token); return false; }
  return true;
}

function logout(token) { sessions.delete(token); }

function getTokenFromReq(req) {
  const cookies = parseCookies(req);
  return cookies[cfg.cookieName];
}

function requireAdmin(req, res) {
  const token = getTokenFromReq(req);
  if (!isValid(token)) {
    const { safeJson } = require('./util');
    safeJson(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

function setCookie(res, token) {
  const maxAge = cfg.sessionHours * 3600;
  res.setHeader('Set-Cookie', `${cfg.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${cfg.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

module.exports = { login, isValid, logout, getTokenFromReq, requireAdmin, setCookie, clearCookie };
