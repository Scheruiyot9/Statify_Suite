const app  = require('./app');
const env  = require('./config/env');
const { pool, query } = require('./config/database');
const { autoSuspendExpired } = require('./modules/platform/platform.service');
const { postDailySummaryEntry, todayLocal } = require('./modules/journal/journal.service');
const { verifyMailer } = require('./shared/mailer');

// ── Midnight daily-summary auto-poster ───────────────────────────────────────
// For companies using journal_posting_mode = 'daily_summary', post yesterday's
// sales for every active branch at midnight each night.
function scheduleDailySummaryPost() {
  const run = async () => {
    // Compute "yesterday" relative to the EAT calendar date (todayLocal()), not the
    // UTC date — using toISOString() here shifts the target date during the 3-hour
    // window each night (21:00–23:59 UTC = 00:00–02:59 EAT) when the two disagree,
    // causing the job to post for the wrong day or find nothing to post.
    const [y, m, d] = todayLocal().split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);

    try {
      const { rows: companies } = await query(`
        SELECT c.company_id, b.branch_id
        FROM companies c
        JOIN branches b ON b.company_id = c.company_id AND b.is_active = TRUE AND b.deleted_at IS NULL
        WHERE c.journal_posting_mode = 'daily_summary'
          AND c.subscription_status = 'active'
      `);

      for (const { company_id, branch_id } of companies) {
        try {
          await postDailySummaryEntry(company_id, branch_id, date, null);
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
  // then schedule the next EAT midnight and repeat every 24 h from there.
  run();

  // setHours(0,0,0,0) would target midnight in the Node process's system timezone
  // (UTC on most hosts), not EAT — compute ms-to-EAT-midnight directly instead.
  const TZ = process.env.TZ_LOCALE || 'Africa/Nairobi';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
  const secondsSinceMidnight = get('hour') * 3600 + get('minute') * 60 + get('second');
  const msToMidnight = (86400 - secondsSinceMidnight) * 1000;

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
