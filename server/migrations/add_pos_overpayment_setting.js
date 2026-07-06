'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/database');

query(`
  ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS pos_allow_overpayment BOOLEAN NOT NULL DEFAULT FALSE
`)
  .then(() => { console.log('Migration OK: pos_allow_overpayment added to companies'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
