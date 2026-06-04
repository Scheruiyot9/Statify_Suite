/**
 * Database migration runner.
 * Executes schema SQL files in dependency order.
 *
 * Usage:  node src/scripts/migrate.js
 *
 * After migration, run the subscription plans seed:
 *   psql $DATABASE_URL -f schema/seed/01_subscription_plans.sql
 *
 * For dev/staging demo data:
 *   node src/scripts/seed.js
 */
require('dotenv').config();
const path   = require('path');
const fs     = require('fs');
const { pool } = require('../config/database');

const SCHEMA_DIR = path.resolve(__dirname, '../../../schema');

const FILES_IN_ORDER = [
  '01_core.sql',         // tenants, auth, products, customers, sales
  '02_pos.sql',          // POS sessions, split payments, returns
  '03_mpesa.sql',        // M-Pesa / Daraja integration
  '04_subscriptions.sql', // company subscription history
  '05_finance.sql',      // CoA, double-entry ledger, bank accounts, journals
  '06_procurement.sql',  // suppliers, POs, GRNs, AP payments
];

async function migrate() {
  const client = await pool.connect();
  console.log('🗃️  Running migrations…\n');

  try {
    for (const file of FILES_IN_ORDER) {
      const filePath = path.join(SCHEMA_DIR, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`  ⚠  ${file} not found — skipping`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf8');
      await client.query(sql);
      console.log(`  ✓  ${file}`);
    }

    console.log('\n✅ Schema migration complete.');
    console.log('\nNext steps:');
    console.log('  Production : psql $DATABASE_URL -f schema/seed/01_subscription_plans.sql');
    console.log('  Dev/staging: node src/scripts/seed.js\n');
  } catch (err) {
    console.error('\n✗ Migration failed:', err.message);
    console.error(err.detail || err.hint || '');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
