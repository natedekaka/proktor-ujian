'use strict';

const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadEnv();

const cfg = {
  title: process.env.PROKTOR_TITLE || 'Proktor Ujian Sanaci',
  host: process.env.PROKTOR_HOST || '0.0.0.0',
  port: parseInt(process.env.PROKTOR_PORT || '9340', 10),
  adminPassword: process.env.PROKTOR_ADMIN_PASSWORD || 'rahasia',
  dataDir: process.env.PROKTOR_DATA_DIR || path.join(process.cwd(), 'data'),
  sessionHours: parseInt(process.env.PROKTOR_SESSION_HOURS || '12', 10),
  penaltyDefault: parseInt(process.env.PROKTOR_PENALTY_PER_VIOLATION || '5', 10),
  maxViolationsDefault: parseInt(process.env.PROKTOR_MAX_VIOLATIONS || '10', 10),
  cookieName: 'proktor_session',
};

cfg.dbPath = path.join(cfg.dataDir, 'proktor.db');

module.exports = cfg;
