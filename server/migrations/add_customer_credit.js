'use strict';

require('dotenv').config();
const { query } = require('../src/config/db');

query(`
  ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS allow_credit BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0
`)
  .then(() => { console.log('Migration OK: allow_credit + credit_limit added to customers'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
