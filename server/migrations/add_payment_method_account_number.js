'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/database');

query(`
  ALTER TABLE payment_methods
    ADD COLUMN IF NOT EXISTS account_number VARCHAR(100)
`)
  .then(() => { console.log('Migration OK: account_number added to payment_methods'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
