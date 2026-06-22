'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query } = require('../src/config/database');

query(`
  ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS payment_details TEXT
`)
  .then(() => { console.log('Migration OK: payment_details added to branches'); process.exit(0); })
  .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
