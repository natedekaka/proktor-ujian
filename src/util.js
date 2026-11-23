'use strict';

const crypto = require('crypto');
const os = require('os');

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push({ name, ip: iface.address });
    }
  }
  return out;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let level = LEVELS.info;
function setLevel(l) { if (LEVELS[l] !== undefined) level = LEVELS[l]; }
const utilFmt = require('util');
function log(lvl, ...args) { if (LEVELS[lvl] >= level) { const msg = args.length ? utilFmt.format(args[0], ...args.slice(1)) : ''; console.log(`[${lvl}] ${msg}`); } }
const logger = {
  debug: (...a) => log('debug', ...a),
  info: (...a) => log('info', ...a),
  warn: (...a) => log('warn', ...a),
  error: (...a) => log('error', ...a),
};

function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    const v = decodeURIComponent(p.slice(i + 1).trim());
    if (k) out[k] = v;
  });
  return out;
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { lanAddresses, setLevel, logger, randomCode, randomToken, nowIso, safeJson, parseCookies, readBody };
