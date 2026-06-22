const { query } = require('../src/config/database');

async function up() {
  await query(`
    ALTER TABLE branches
      ADD COLUMN IF NOT EXISTS payment_details TEXT
  `);
  console.log('Migration: add_branch_payment_details — done');
}

module.exports = { up };
