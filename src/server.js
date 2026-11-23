'use strict';

const http = require('http');
const cfg = require('./config');
const db = require('./db');
const { createHandler } = require('./http');
const { setLevel, logger, lanAddresses } = require('./util');

function main() {
  setLevel(process.env.PROKTOR_LOG_LEVEL || 'info');
  db.init();

  const handler = createHandler();
  const server = http.createServer(handler);

  server.listen(cfg.port, cfg.host, () => {
    logger.info('==========================================================');
    logger.info(' %s berjalan', cfg.title);
    logger.info(' URL    : http://localhost:%d', cfg.port);
    for (const a of lanAddresses()) logger.info('          http://%s:%d', a.ip, cfg.port);
    logger.info(' Admin  : http://localhost:%d/admin.html', cfg.port);
    logger.info(' Siswa  : http://localhost:%d/  (atau /student.html)', cfg.port);
    logger.info(' Data   : %s', cfg.dataDir);
    logger.info('==========================================================');
  });

  const shutdown = (sig) => {
    logger.info('mematikan (%s)...', sig);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
