'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/database');

query(`
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
`)
  .then(() => { console.log('Migration OK: customer_topups table created'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
