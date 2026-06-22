'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/database');

query(`
  ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS default_credit_limit NUMERIC(15,2) NOT NULL DEFAULT 0
`)
  .then(() => { console.log('Migration OK: default_credit_limit added to companies'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
