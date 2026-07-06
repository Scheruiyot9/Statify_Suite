'use strict';

// Runs today's two new migrations against the database pointed to by the
// environment this script is run in (uses the same DB_* env vars as the app).
// Safe to re-run — both underlying statements use IF NOT EXISTS.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, pool } = require('../src/config/database');

const steps = [
  {
    name: 'pos_allow_overpayment column on companies',
    sql: `ALTER TABLE companies
            ADD COLUMN IF NOT EXISTS pos_allow_overpayment BOOLEAN NOT NULL DEFAULT FALSE`,
  },
  {
    name: 'customer_topups table',
    sql: `
      CREATE TABLE IF NOT EXISTS customer_topups (
          topup_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id        UUID NOT NULL REFERENCES companies(company_id),
          branch_id         UUID REFERENCES branches(branch_id),
          session_id        UUID REFERENCES pos_sessions(session_id),
          customer_id       UUID NOT NULL REFERENCES customers(customer_id),
          amount            NUMERIC(15,2) NOT NULL,
          payment_method_id UUID REFERENCES payment_methods(payment_method_id),
          reference_number  VARCHAR(100),
          received_by       UUID NOT NULL REFERENCES users(user_id),
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_customer_topups_session ON customer_topups (session_id);
      CREATE INDEX IF NOT EXISTS idx_customer_topups_customer ON customer_topups (customer_id);
    `,
  },
];

(async () => {
  console.log(`Running ${steps.length} migration(s) against ${process.env.DB_NAME}@${process.env.DB_HOST || 'localhost'}...\n`);
  for (const step of steps) {
    try {
      await query(step.sql);
      console.log(`  OK  ${step.name}`);
    } catch (e) {
      console.error(`  FAIL  ${step.name}: ${e.message}`);
      await pool.end();
      process.exit(1);
    }
  }
  console.log('\nDone.');
  await pool.end();
  process.exit(0);
})();
