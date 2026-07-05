// One-off catch-up for the daily-summary auto-posting bug (fixed in server.js):
// for the past 2 weeks, companies on journal_posting_mode='daily_summary' likely
// missed several nights because the scheduler errored out before posting anything.
//
// This reuses postDailySummaryEntry() — the exact same function and balancing
// logic the nightly job calls — for every (company, branch, date) in range, so
// there's no risk of drifting from the real accounting logic. Already-posted
// dates and days with no sales are skipped silently, same as the live scheduler.
//
// Usage:
//   cd server && node src/scripts/backfill_daily_summaries.js [days]
// [days] defaults to 14 (i.e. covers the last two weeks up to yesterday).

require('dotenv').config();
const { pool, query } = require('../config/database');
const { postDailySummaryEntry, todayLocal } = require('../modules/journal/journal.service');

async function main() {
  const daysBack = parseInt(process.argv[2] || '14', 10);

  const { rows: companies } = await query(`
    SELECT c.company_id, c.company_name, b.branch_id, b.branch_name
    FROM companies c
    JOIN branches b ON b.company_id = c.company_id AND b.is_active = TRUE AND b.deleted_at IS NULL
    WHERE c.journal_posting_mode = 'daily_summary'
      AND c.subscription_status = 'active'
  `);

  if (!companies.length) {
    console.log('No companies on daily_summary mode — nothing to backfill.');
    return;
  }

  const [y, m, d] = todayLocal().split('-').map(Number);
  let posted = 0, skipped = 0, failed = 0;

  for (let i = 1; i <= daysBack; i++) {
    const date = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10);
    for (const { company_id, company_name, branch_id, branch_name } of companies) {
      try {
        await postDailySummaryEntry(company_id, branch_id, date, null);
        console.log(`✓ Posted ${date} — ${company_name} / ${branch_name}`);
        posted++;
      } catch (err) {
        if (err.message?.includes('already posted') || err.message?.includes('No unposted') || err.message === 'Nothing to post') {
          skipped++;
        } else {
          console.error(`✗ Failed ${date} — ${company_name} / ${branch_name}: ${err.message}`);
          failed++;
        }
      }
    }
  }

  console.log(`\nDone. Posted ${posted}, skipped ${skipped} (already posted / no sales), failed ${failed}.`);
}

main()
  .catch((err) => { console.error('Backfill script error:', err); process.exitCode = 1; })
  .finally(() => pool.end());
