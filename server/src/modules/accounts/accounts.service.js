const { query } = require('../../config/database');
const AppError  = require('../../shared/AppError');

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

async function listAccounts(companyId) {
  const { rows } = await query(`
    SELECT a.account_id, a.account_code, a.account_name, a.account_type,
           a.account_subtype, a.parent_account_id, a.description,
           a.is_active, a.is_system,
           p.account_name AS parent_name
    FROM accounts a
    LEFT JOIN accounts p ON p.account_id = a.parent_account_id
    WHERE a.company_id = $1
    ORDER BY a.account_type, a.account_code
  `, [companyId]);
  return rows;
}

async function getAccount(companyId, accountId) {
  const { rows } = await query(
    `SELECT * FROM accounts WHERE account_id = $1 AND company_id = $2`,
    [accountId, companyId]
  );
  if (!rows.length) throw AppError.notFound('Account');
  return rows[0];
}

async function createAccount(companyId, data) {
  const { account_code, account_name, account_type, account_subtype,
          parent_account_id, description } = data;

  if (!account_code || !account_name) throw AppError.badRequest('account_code and account_name are required');
  if (!TYPES.includes(account_type))  throw AppError.badRequest(`account_type must be one of: ${TYPES.join(', ')}`);

  if (parent_account_id) {
    const { rows: parent } = await query(
      `SELECT account_id FROM accounts WHERE account_id = $1 AND company_id = $2`,
      [parent_account_id, companyId]
    );
    if (!parent.length) throw AppError.badRequest('Parent account not found');
  }

  const { rows } = await query(`
    INSERT INTO accounts
      (company_id, account_code, account_name, account_type, account_subtype, parent_account_id, description)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [companyId, account_code.trim(), account_name.trim(), account_type,
      account_subtype || null, parent_account_id || null, description || null]);

  return rows[0];
}

async function updateAccount(companyId, accountId, data) {
  const allowed = ['account_code','account_name','account_type','account_subtype',
                   'parent_account_id','description','is_active'];
  const sets = [];
  const vals = [companyId, accountId];

  for (const [k, v] of Object.entries(data)) {
    if (!allowed.includes(k)) continue;
    if (k === 'account_type' && !TYPES.includes(v))
      throw AppError.badRequest(`account_type must be one of: ${TYPES.join(', ')}`);
    vals.push(v === '' ? null : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) throw AppError.badRequest('No valid fields to update');

  const { rows } = await query(`
    UPDATE accounts SET ${sets.join(', ')}, updated_at = now()
    WHERE company_id = $1 AND account_id = $2
    RETURNING *
  `, vals);
  if (!rows.length) throw AppError.notFound('Account');
  return rows[0];
}

async function deleteAccount(companyId, accountId) {
  const { rows: acc } = await query(
    `SELECT is_system FROM accounts WHERE account_id = $1 AND company_id = $2`,
    [accountId, companyId]
  );
  if (!acc.length) throw AppError.notFound('Account');
  if (acc[0].is_system) throw AppError.forbidden('System accounts cannot be deleted');

  const { rows: children } = await query(
    `SELECT account_id FROM accounts WHERE parent_account_id = $1 LIMIT 1`,
    [accountId]
  );
  if (children.length) throw AppError.conflict('Cannot delete an account that has sub-accounts');

  await query(
    `UPDATE accounts SET is_active = FALSE, updated_at = now() WHERE account_id = $1`,
    [accountId]
  );
  return { deleted: true };
}

const DEFAULT_ACCOUNTS = [
  // Assets
  { code: '1000', name: 'Cash on Hand',           type: 'asset',     subtype: 'current_asset', system: true },
  { code: '1010', name: 'Bank - Main Account',     type: 'asset',     subtype: 'current_asset', system: false },
  { code: '1100', name: 'Accounts Receivable',     type: 'asset',     subtype: 'current_asset', system: true },
  { code: '1200', name: 'Inventory',               type: 'asset',     subtype: 'current_asset', system: true },
  { code: '1300', name: 'Prepaid Expenses',        type: 'asset',     subtype: 'current_asset', system: false },
  { code: '1500', name: 'Fixed Assets',            type: 'asset',     subtype: 'fixed_asset',   system: false },
  { code: '1510', name: 'Accumulated Depreciation',type: 'asset',     subtype: 'fixed_asset',   system: false },
  // Liabilities
  { code: '2000', name: 'Accounts Payable',        type: 'liability', subtype: 'current_liability', system: true },
  { code: '2100', name: 'VAT Payable',             type: 'liability', subtype: 'current_liability', system: false },
  { code: '2200', name: 'PAYE Payable',            type: 'liability', subtype: 'current_liability', system: false },
  { code: '2300', name: 'Short-term Loans',        type: 'liability', subtype: 'current_liability', system: false },
  // Equity
  { code: '3000', name: "Owner's Capital",         type: 'equity',    subtype: null, system: false },
  { code: '3100', name: 'Retained Earnings',       type: 'equity',    subtype: null, system: false },
  // Revenue
  { code: '4000', name: 'Sales Revenue',           type: 'revenue',   subtype: null, system: true },
  { code: '4100', name: 'Service Revenue',         type: 'revenue',   subtype: null, system: false },
  { code: '4200', name: 'Other Income',            type: 'revenue',   subtype: null, system: false },
  // Expenses
  { code: '5000', name: 'Cost of Goods Sold',      type: 'expense',   subtype: null, system: true },
  { code: '5100', name: 'Salaries & Wages',        type: 'expense',   subtype: null, system: false },
  { code: '5200', name: 'Rent',                    type: 'expense',   subtype: null, system: false },
  { code: '5300', name: 'Utilities',               type: 'expense',   subtype: null, system: false },
  { code: '5400', name: 'Marketing & Advertising', type: 'expense',   subtype: null, system: false },
  { code: '5500', name: 'Office Supplies',         type: 'expense',   subtype: null, system: false },
  { code: '5600', name: 'Depreciation',            type: 'expense',   subtype: null, system: false },
  { code: '5700', name: 'Bank Charges',            type: 'expense',   subtype: null, system: false },
  { code: '5800', name: 'Other Expenses',          type: 'expense',   subtype: null, system: false },
];

async function seedDefaults(companyId) {
  const { rows: existing } = await query(
    `SELECT COUNT(*) AS cnt FROM accounts WHERE company_id = $1`, [companyId]
  );
  if (parseInt(existing[0].cnt) > 0)
    throw AppError.conflict('Chart of accounts already exists for this company. Clear it first or add accounts manually.');

  for (const a of DEFAULT_ACCOUNTS) {
    await query(`
      INSERT INTO accounts (company_id, account_code, account_name, account_type, account_subtype, is_system)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (company_id, account_code) DO NOTHING
    `, [companyId, a.code, a.name, a.type, a.subtype, a.system]);
  }
  return { seeded: DEFAULT_ACCOUNTS.length };
}

// ── Account Balance (from ledger_entry_lines) ────────────────────────────────

async function getAccountBalance(companyId, accountId) {
  const { rows: accRows } = await query(
    `SELECT account_code, account_name, account_type FROM accounts WHERE account_id = $1 AND company_id = $2`,
    [accountId, companyId]
  );
  if (!accRows.length) throw AppError.notFound('Account');

  const { account_code, account_name, account_type } = accRows[0];

  const { rows: balRows } = await query(`
    SELECT COALESCE(SUM(jel.debit),  0)::numeric AS total_debit,
           COALESCE(SUM(jel.credit), 0)::numeric AS total_credit
    FROM ledger_entry_lines jel
    JOIN journal_entries je ON je.journal_entry_id = jel.journal_entry_id
    WHERE je.company_id = $1 AND je.status = 'posted' AND jel.account_id = $2
  `, [companyId, accountId]);

  const dr      = parseFloat(balRows[0]?.total_debit  ?? 0);
  const cr      = parseFloat(balRows[0]?.total_credit ?? 0);
  const balance = +(dr - cr).toFixed(2);

  return {
    accountId,
    accountCode:  account_code,
    accountName:  account_name,
    accountType:  account_type,
    balance,
    totalDebits:  +dr.toFixed(2),
    totalCredits: +cr.toFixed(2),
  };
}

// ── Account Ledger (from ledger_entry_lines) ─────────────────────────────────

async function getAccountLedger(companyId, accountId, { startDate, endDate, page = 1, limit = 50 } = {}) {
  const { getLedgerEntries } = require('../reports/reports.service');
  return getLedgerEntries(companyId, { accountId, startDate, endDate, page, limit });
}

// ── Single Journal Entry by journal_entry_id ──────────────────────────────────

async function getJournalEntry(companyId, journalEntryId) {
  const { rows: [header] } = await query(`
    SELECT journal_entry_id, entry_number, entry_date, description, source_type,
           source_id, status
      FROM journal_entries
     WHERE journal_entry_id = $1 AND company_id = $2
  `, [journalEntryId, companyId]);

  if (!header) throw AppError.notFound('Journal entry');

  const { rows: lines } = await query(`
    SELECT lel.line_id, lel.debit::numeric AS debit, lel.credit::numeric AS credit,
           lel.description, lel.entity_type, lel.entity_id,
           a.account_code, a.account_name,
           CASE lel.entity_type
             WHEN 'customer'     THEN c.customer_name
             WHEN 'supplier'     THEN s.supplier_name
             WHEN 'bank_account' THEN ba.account_name
           END AS entity_name
      FROM ledger_entry_lines lel
      JOIN accounts     a  ON a.account_id        = lel.account_id
      LEFT JOIN customers     c  ON lel.entity_type = 'customer'     AND c.customer_id      = lel.entity_id
      LEFT JOIN suppliers     s  ON lel.entity_type = 'supplier'     AND s.supplier_id      = lel.entity_id
      LEFT JOIN bank_accounts ba ON lel.entity_type = 'bank_account' AND ba.bank_account_id = lel.entity_id
     WHERE lel.journal_entry_id = $1
     ORDER BY lel.line_id
  `, [journalEntryId]);

  return {
    journal_number: header.entry_number,
    entry_date:     header.entry_date,
    status:         header.status,
    description:    header.description,
    reference:      null,
    source_type:    header.source_type,
    lines: lines.map((l) => ({
      lineId:      l.line_id,
      accountCode: l.account_code,
      accountName: l.account_name,
      entityType:  l.entity_type,
      entityName:  l.entity_name,
      description: l.description,
      debit:       parseFloat(l.debit),
      credit:      parseFloat(l.credit),
    })),
  };
}

module.exports = { listAccounts, getAccount, createAccount, updateAccount, deleteAccount, seedDefaults, getAccountBalance, getAccountLedger, getJournalEntry };
