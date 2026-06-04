const app  = require('./app');
const env  = require('./config/env');
const { pool } = require('./config/database');
const { autoSuspendExpired } = require('./modules/platform/platform.service');
const { verifyMailer } = require('./shared/mailer');

// ── Auto-suspend scheduler ────────────────────────────────────────────────────
// Fires once at startup (catches any missed dates) then every 24 hours.
function scheduleAutoSuspend() {
  const run = async () => {
    try {
      const suspended = await autoSuspendExpired();
      if (suspended.length) {
        console.log(`[auto-suspend] Suspended ${suspended.length} expired company/companies:`,
          suspended.map((c) => c.company_name).join(', '));
      }
    } catch (err) {
      console.error('[auto-suspend] Error:', err.message);
    }
  };
  run();                             // immediate check on startup
  setInterval(run, 24 * 60 * 60 * 1000); // then every 24 hours
}

const start = async () => {
  // Verify DB connectivity before accepting traffic
  try {
    await pool.query('SELECT 1');
    console.log('✓ PostgreSQL connected');
  } catch (err) {
    console.error('✗ PostgreSQL connection failed:', err.message);
    process.exit(1);
  }

  scheduleAutoSuspend();
  await verifyMailer();

  const server = app.listen(env.port, () => {
    console.log(`✓ Server running on port ${env.port} [${env.nodeEnv}]`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n${signal} received — shutting down gracefully`);
    server.close(async () => {
      await pool.end();
      console.log('✓ PostgreSQL pool closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
};

start();
