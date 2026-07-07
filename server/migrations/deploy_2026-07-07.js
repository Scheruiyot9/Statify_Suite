'use strict';

// Runs today's two new migrations (void support for cash-outs/transfers, and
// credit-payment reversal tracking) against the database pointed to by the
// environment this script is run in (uses the same DB_* env vars as the app).
// Safe to re-run — all statements use IF NOT EXISTS.
//
// Depends on deploy_2026-07-06.js having already been run in this environment
// (the customer_topups table must exist before the ALTER TABLE below can add a
// column to it).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, pool } = require('../src/config/database');

const steps = [
  {
    name: 'void columns on session_cash_outs / session_transfers',
    sql: `
      ALTER TABLE session_cash_outs
        ADD COLUMN IF NOT EXISTS status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
        ADD COLUMN IF NOT EXISTS voided_by_user_id   UUID REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS voided_at           TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS void_reason         TEXT;

      ALTER TABLE session_transfers
        ADD COLUMN IF NOT EXISTS status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
        ADD COLUMN IF NOT EXISTS voided_by_user_id   UUID REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS voided_at           TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS void_reason         TEXT;
    `,
  },
  {
    name: 'credit_payment_applications table + customer_topups.journal_entry_id',
    sql: `
      CREATE TABLE IF NOT EXISTS credit_payment_applications (
        application_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id       UUID NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
        journal_entry_id UUID NOT NULL REFERENCES journal_entries(journal_entry_id) ON DELETE CASCADE,
        customer_id      UUID NOT NULL REFERENCES customers(customer_id),
        transaction_id   UUID NOT NULL REFERENCES sales_transactions(transaction_id),
        amount_applied   NUMERIC(15,2) NOT NULL,
        previous_status  VARCHAR(20) NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_credit_payment_applications_je ON credit_payment_applications(journal_entry_id);

      ALTER TABLE customer_topups
        ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(journal_entry_id) ON DELETE SET NULL;
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
