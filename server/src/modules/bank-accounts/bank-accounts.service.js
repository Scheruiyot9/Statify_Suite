const { query, transaction } = require('../../config/database');
const AppError  = require('../../shared/AppError');
const jrn = require('../journal/journal.service');

// Compute live balance from ledger when a GL account is linked;
// fall back to stored current_balance when not linked.
const LIVE_BALANCE_SQL = `
  CASE
    WHEN ba.account_id IS NOT NULL THEN
      COALESCE((
        SELECT (SUM(lel.debit) - SUM(lel.credit))::numeric
        FROM ledger_entry_lines lel
        JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
        WHERE je.status = 'posted'
          AND lel.account_id = ba.account_id
      ), 0)
    ELSE ba.current_balance::numeric
  END AS current_balance
`;

async function listBankAccounts(companyId) {
  const { rows } = await query(`
    SELECT ba.bank_account_id, ba.company_id, ba.branch_id, ba.account_id,
           ba.account_name, ba.bank_name, ba.account_number, ba.bank_branch,
           ba.currency, ba.opening_balance, ba.is_default, ba.notes,
           ba.is_active, ba.created_at, ba.updated_at,
           a.account_name AS coa_account_name,
           b.branch_name,
           ${LIVE_BALANCE_SQL}
    FROM bank_accounts ba
    LEFT JOIN accounts a ON a.account_id = ba.account_id
    LEFT JOIN branches b ON b.branch_id  = ba.branch_id
    WHERE ba.company_id = $1
    ORDER BY ba.is_default DESC, ba.account_name
  `, [companyId]);
  return rows;
}

async function getBankAccount(companyId, id) {
  const { rows } = await query(`
    SELECT ba.bank_account_id, ba.company_id, ba.branch_id, ba.account_id,
           ba.account_name, ba.bank_name, ba.account_number, ba.bank_branch,
           ba.currency, ba.opening_balance, ba.is_default, ba.notes,
           ba.is_active, ba.created_at, ba.updated_at,
           ${LIVE_BALANCE_SQL}
    FROM bank_accounts ba
    WHERE ba.bank_account_id = $1 AND ba.company_id = $2
  `, [id, companyId]);
  if (!rows.length) throw AppError.notFound('Bank account');
  return rows[0];
}

async function createBankAccount(companyId, data) {
  const { account_name, bank_name, account_number, bank_branch,
          currency = 'KES', opening_balance = 0,
          is_default = false, account_id, branch_id, notes } = data;

  if (!account_name) throw AppError.badRequest('account_name is required');
  if (!bank_name)    throw AppError.badRequest('bank_name is required');

  return transaction(async (client) => {
    if (is_default) {
      await client.query(
        `UPDATE bank_accounts SET is_default = FALSE WHERE company_id = $1`,
        [companyId]
      );
    }

    const { rows } = await client.query(`
      INSERT INTO bank_accounts
        (company_id, branch_id, account_id, account_name, bank_name, account_number,
         bank_branch, currency, opening_balance, current_balance, is_default, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11)
      RETURNING *
    `, [companyId, branch_id || null, account_id || null,
        account_name.trim(), bank_name.trim(), account_number || null,
        bank_branch || null, currency, parseFloat(opening_balance) || 0,
        is_default, notes || null]);

    const bankAccount = rows[0];

    // Post opening balance journal entry if balance > 0
    await jrn.postOpeningBalanceEntry(client, companyId, bankAccount);

    return bankAccount;
  });
}

async function updateBankAccount(companyId, id, data) {
  const allowed = ['account_name','bank_name','account_number','bank_branch',
                   'currency','is_default','account_id','branch_id','notes','is_active'];
  const sets = [];
  const vals = [companyId, id];

  if (data.is_default) {
    await query(`UPDATE bank_accounts SET is_default = FALSE WHERE company_id = $1`, [companyId]);
  }

  for (const [k, v] of Object.entries(data)) {
    if (!allowed.includes(k)) continue;
    vals.push(v === '' ? null : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) throw AppError.badRequest('No valid fields to update');

  const { rows } = await query(`
    UPDATE bank_accounts SET ${sets.join(', ')}, updated_at = now()
    WHERE company_id = $1 AND bank_account_id = $2
    RETURNING *
  `, vals);
  if (!rows.length) throw AppError.notFound('Bank account');
  return rows[0];
}

async function deleteBankAccount(companyId, id) {
  const { rows } = await query(
    `UPDATE bank_accounts SET is_active = FALSE, updated_at = now()
     WHERE bank_account_id = $1 AND company_id = $2 RETURNING bank_account_id`,
    [id, companyId]
  );
  if (!rows.length) throw AppError.notFound('Bank account');
  return { deleted: true };
}

// ── Bank Account Ledger (queries ledger_entry_lines via linked GL account_id) ──

async function getBankAccountLedger(companyId, bankAccountId, { startDate, endDate, page = 1, limit = 50 } = {}) {
  // Verify bank account and get linked GL account_id with live ledger balance
  const { rows: baRows } = await query(`
    SELECT ba.bank_account_id, ba.account_name, ba.bank_name, ba.account_number,
           ba.currency, ba.account_id,
           ${LIVE_BALANCE_SQL}
    FROM bank_accounts ba
    WHERE ba.bank_account_id = $1 AND ba.company_id = $2
  `, [bankAccountId, companyId]);
  if (!baRows.length) throw AppError.notFound('Bank account');
  const ba = baRows[0];

  const pg = parseInt(page,  10);
  const lm = parseInt(limit, 10);

  // If no GL account is linked, return an empty ledger with a helpful message
  if (!ba.account_id) {
    const start = startDate || new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
    const end   = endDate   || new Date().toISOString().slice(0, 10);
    return {
      bankAccount: { ...ba, currentBalance: parseFloat(ba.current_balance) },
      period:      { startDate: start, endDate: end },
      entries:     [],
      total:       0,
      page:        pg,
      limit:       lm,
      pages:       0,
      summary:     { totalIn: 0, totalOut: 0 },
      warning:     'This bank account is not linked to a Chart of Accounts entry. Link it to see ledger entries.',
    };
  }

  // Delegate to getLedgerEntries — single source of truth
  const { getLedgerEntries } = require('../reports/reports.service');
  const result = await getLedgerEntries(companyId, {
    accountId: ba.account_id,
    startDate,
    endDate,
    page:  pg,
    limit: lm,
  });

  // For bank/cash (asset) accounts: debit = money in, credit = money out
  const totalIn  = result.entries.reduce((s, e) => s + (e.debit  ?? 0), 0);
  const totalOut = result.entries.reduce((s, e) => s + (e.credit ?? 0), 0);

  return {
    bankAccount: { ...ba, currentBalance: parseFloat(ba.current_balance) },
    period:      result.period,
    entries:     result.entries,
    total:       result.total,
    page:        result.page,
    limit:       result.limit,
    pages:       result.pages,
    summary:     { totalIn: +totalIn.toFixed(2), totalOut: +totalOut.toFixed(2) },
  };
}

module.exports = { listBankAccounts, getBankAccount, createBankAccount, updateBankAccount, deleteBankAccount, getBankAccountLedger };
