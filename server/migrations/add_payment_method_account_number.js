const { query } = require('../src/config/database');

async function up() {
  await query(`
    ALTER TABLE payment_methods
      ADD COLUMN IF NOT EXISTS account_number VARCHAR(100)
  `);
  console.log('Migration: add_payment_method_account_number — done');
}

module.exports = { up };
