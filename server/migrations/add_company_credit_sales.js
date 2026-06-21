'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/database');

query(`
  ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS credit_sales_enabled BOOLEAN NOT NULL DEFAULT FALSE
`)
  .then(() => { console.log('Migration OK: credit_sales_enabled added to companies'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
