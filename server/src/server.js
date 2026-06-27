const app  = require('./app');
const env  = require('./config/env');
const { pool, query } = require('./config/database');
const { autoSuspendExpired } = require('./modules/platform/platform.service');
const { postDailySummaryEntry } = require('./modules/journal/journal.service');
const { verifyMailer } = require('./shared/mailer');

// ── Midnight daily-summary auto-poster ───────────────────────────────────────
// For companies using journal_posting_mode = 'daily_summary', post yesterday's
// sales for every active branch at midnight each night.
function scheduleDailySummaryPost() {
  const run = async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);

    try {
      const { rows: companies } = await query(`
        SELECT c.company_id, b.branch_id
        FROM companies c
        JOIN branches b ON b.company_id = c.company_id AND b.is_active = TRUE AND b.deleted_at IS NULL
        WHERE c.journal_posting_mode = 'daily_summary'
          AND c.subscription_status = 'active'
          AND c.deleted_at IS NULL
      `);

      for (const { company_id, branch_id } of companies) {
        try {
          await postDailySummaryEntry(company_id, branch_id, date, 'system');
          console.log(`[daily-summary] Posted ${date} — company ${company_id} branch ${branch_id}`);
        } catch (err) {
          // "already posted" and "no unposted sales" are normal — skip silently
          if (!err.message?.includes('already posted') && !err.message?.includes('No unposted')) {
            console.error(`[daily-summary] Failed ${date} company ${company_id} branch ${branch_id}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('[daily-summary] Scheduler error:', err.message);
    }
  };

  // Run once immediately on startup (catches any day missed due to a restart),
  // then schedule the next midnight and repeat every 24 h from there.
  run();

  const now          = new Date();
  const midnight     = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  const msToMidnight = midnight - now;

  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, msToMidnight);

  console.log(`[daily-summary] Scheduled — next midnight run in ${Math.round(msToMidnight / 60000)} min`);
}

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
  scheduleDailySummaryPost();
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
