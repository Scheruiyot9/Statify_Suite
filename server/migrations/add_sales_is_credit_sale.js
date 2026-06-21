'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/database');

query(`
  ALTER TABLE sales_transactions
    ADD COLUMN IF NOT EXISTS is_credit_sale BOOLEAN NOT NULL DEFAULT FALSE
`)
  .then(() => { console.log('Migration OK: is_credit_sale added to sales_transactions'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
