'use strict';

const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const { _post } = require('../journal/journal.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(val) {
  if (!val) return new Date().toISOString().slice(0, 10);
  if (typeof val === 'string') return val.slice(0, 10);
  return new Date(val).toISOString().slice(0, 10);
}

function validateLines(lines) {
  if (!lines?.length) throw AppError.badRequest('At least one line is required');
  for (const l of lines) {
    if (!l.accountId) throw AppError.badRequest('Each line requires accountId');
    if ((l.debit  || 0) < 0 || (l.credit || 0) < 0)
      throw AppError.badRequest('Debit/credit cannot be negative');
    if ((l.debit  || 0) > 0 && (l.credit || 0) > 0)
      throw AppError.badRequest('A line cannot carry both debit and credit');
  }
}

async function insertLines(client, journalId, lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(`
      INSERT INTO journal_lines
        (journal_id, account_id, description, debit, credit, entity_type, entity_id, line_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [journalId, l.accountId, l.description || null,
        parseFloat(l.debit)  || 0,
        parseFloat(l.credit) || 0,
        l.entityType || null, l.entityId || null, i]);
  }
}

async function nextJournalNumber(client, companyId) {
  const { rows: [{ journal_counter: jnl_counter }] } = await client.query(
    `UPDATE companies SET journal_counter = journal_counter + 1
     WHERE company_id = $1 RETURNING journal_counter`,
    [companyId]
  );
  return `JNL-${new Date().getFullYear()}-${String(jnl_counter).padStart(5, '0')}`;
}

const LINES_QUERY = `
  SELECT jl.journal_line_id, jl.account_id, jl.description,
         jl.debit::numeric, jl.credit::numeric, jl.line_order,
         jl.entity_type, jl.entity_id,
         a.account_code, a.account_name, a.account_type,
         CASE jl.entity_type
           WHEN 'customer'     THEN c.customer_name
           WHEN 'supplier'     THEN s.supplier_name
           WHEN 'bank_account' THEN ba.account_name
         END AS entity_name
  FROM journal_lines jl
  JOIN accounts a ON a.account_id = jl.account_id
  LEFT JOIN customers     c  ON jl.entity_type = 'customer'     AND c.customer_id      = jl.entity_id
  LEFT JOIN suppliers     s  ON jl.entity_type = 'supplier'     AND s.supplier_id      = jl.entity_id
  LEFT JOIN bank_accounts ba ON jl.entity_type = 'bank_account' AND ba.bank_account_id = jl.entity_id
  WHERE jl.journal_id = $1
  ORDER BY jl.line_order
`;

function mapLine(l) {
  return {
    lineId:      l.journal_line_id,
    accountId:   l.account_id,
    accountCode: l.account_code,
    accountName: l.account_name,
    accountType: l.account_type,
    description: l.description,
    debit:       parseFloat(l.debit),
    credit:      parseFloat(l.credit),
    lineOrder:   l.line_order,
    entityType:  l.entity_type,
    entityId:    l.entity_id,
    entityName:  l.entity_name,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function listJournals(companyId, { startDate, endDate, status, page = 1, limit = 25 } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const pg    = parseInt(page,  10);
  const lm    = parseInt(limit, 10);

  const conds = ['j.company_id = $1', 'j.entry_date BETWEEN $2 AND $3'];
  const vals  = [companyId, start, end];

  if (status) { vals.push(status); conds.push(`j.status = $${vals.length}`); }

  vals.push(lm, (pg - 1) * lm);

  const { rows } = await query(`
    SELECT j.journal_id, j.journal_number, j.entry_date, j.description, j.reference,
           j.status, j.created_at,
           u.first_name || ' ' || u.last_name AS created_by,
           COALESCE(SUM(jl.debit),  0)::numeric AS total_debit,
           COALESCE(SUM(jl.credit), 0)::numeric AS total_credit,
           COUNT(*) OVER() AS total_count
    FROM journals j
    LEFT JOIN users u         ON u.user_id   = j.created_by_user_id
    LEFT JOIN journal_lines jl ON jl.journal_id = j.journal_id
    WHERE ${conds.join(' AND ')}
    GROUP BY j.journal_id, u.first_name, u.last_name
    ORDER BY j.entry_date DESC, j.journal_number DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    journals: rows.map(({ total_count, ...r }) => ({
      journalId:     r.journal_id,
      journalNumber: r.journal_number,
      entryDate:     r.entry_date,
      description:   r.description,
      reference:     r.reference,
      status:        r.status,
      createdBy:     r.created_by,
      totalDebit:    parseFloat(r.total_debit),
      totalCredit:   parseFloat(r.total_credit),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
    period: { startDate: start, endDate: end },
  };
}

async function getJournal(companyId, journalId) {
  const { rows: [j] } = await query(`
    SELECT j.*,
           u.first_name || ' ' || u.last_name AS created_by,
           p.first_name || ' ' || p.last_name AS posted_by,
           v.first_name || ' ' || v.last_name AS voided_by
    FROM journals j
    LEFT JOIN users u ON u.user_id = j.created_by_user_id
    LEFT JOIN users p ON p.user_id = j.posted_by_user_id
    LEFT JOIN users v ON v.user_id = j.voided_by_user_id
    WHERE j.journal_id = $1 AND j.company_id = $2
  `, [journalId, companyId]);
  if (!j) throw AppError.notFound('Journal');

  const { rows: lines } = await query(LINES_QUERY, [journalId]);
  return { ...j, lines: lines.map(mapLine) };
}

async function createJournal(companyId, userId, { entryDate, description, reference, lines }) {
  validateLines(lines);

  let journalId;
  await transaction(async (client) => {
    const journalNumber = await nextJournalNumber(client, companyId);

    const { rows: [j] } = await client.query(`
      INSERT INTO journals (company_id, journal_number, entry_date, description, reference, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING journal_id
    `, [companyId, journalNumber,
        toDateStr(entryDate), description || null, reference || null, userId]);

    journalId = j.journal_id;
    await insertLines(client, j.journal_id, lines);
  });
  return getJournal(companyId, journalId);
}

async function updateJournal(companyId, journalId, userId, { entryDate, description, reference, lines }) {
  const { rows: [j] } = await query(
    `SELECT status FROM journals WHERE journal_id = $1 AND company_id = $2`,
    [journalId, companyId]
  );
  if (!j) throw AppError.notFound('Journal');
  if (j.status !== 'draft') throw AppError.conflict('Only draft journals can be edited');

  validateLines(lines);

  await transaction(async (client) => {
    await client.query(`
      UPDATE journals SET entry_date = $1, description = $2, reference = $3, updated_at = now()
      WHERE journal_id = $4
    `, [toDateStr(entryDate), description || null, reference || null, journalId]);

    await client.query(`DELETE FROM journal_lines WHERE journal_id = $1`, [journalId]);
    await insertLines(client, journalId, lines);
  });
  return getJournal(companyId, journalId);
}

// ── Post ──────────────────────────────────────────────────────────────────────

async function postJournal(companyId, journalId, userId) {
  await transaction(async (client) => {
    const { rows: [j] } = await client.query(
      `SELECT * FROM journals WHERE journal_id = $1 AND company_id = $2 FOR UPDATE`,
      [journalId, companyId]
    );
    if (!j) throw AppError.notFound('Journal');
    if (j.status !== 'draft') throw AppError.conflict(`Journal is already ${j.status}`);

    const { rows: lines } = await client.query(
      `SELECT jl.*, a.is_active, a.account_code FROM journal_lines jl
       JOIN accounts a ON a.account_id = jl.account_id
       WHERE jl.journal_id = $1`,
      [journalId]
    );
    if (!lines.length) throw AppError.badRequest('Journal has no lines');

    const inactive = lines.filter((l) => !l.is_active);
    if (inactive.length) throw AppError.badRequest('One or more accounts are inactive');

    const totalDr = lines.reduce((s, l) => s + parseFloat(l.debit),  0);
    const totalCr = lines.reduce((s, l) => s + parseFloat(l.credit), 0);
    if (Math.abs(totalDr - totalCr) > 0.005)
      throw AppError.badRequest(`Entry not balanced: DR ${totalDr.toFixed(2)} ≠ CR ${totalCr.toFixed(2)}`);

    const ledgerEntryId = await _post(client, companyId, {
      entryDate:   toDateStr(j.entry_date),
      description: j.description,
      sourceType:  'MANUAL',
      sourceId:    j.journal_id,
      userId,
      lines: lines.map((l) => ({
        accountId:   l.account_id,
        debit:       parseFloat(l.debit),
        credit:      parseFloat(l.credit),
        description: l.description,
        entityType:  l.entity_type,
        entityId:    l.entity_id,
      })),
    });

    await client.query(`
      UPDATE journals
      SET status = 'posted', ledger_entry_id = $1, posted_by_user_id = $2, posted_at = now(), updated_at = now()
      WHERE journal_id = $3
    `, [ledgerEntryId, userId, journalId]);

    // Manual journals can post directly against a customer's AR account (e.g. a
    // write-off or adjustment); apply the same delta to customers.credit_balance
    // as sales/payments do, or the customer's balance silently drifts out of sync
    // with the ledger. Incremental (not a full ledger recalc) because AR postings
    // for credit sales aren't always tagged per-customer in the ledger (summary
    // posting mode aggregates them), so a recalc would wipe out sale-driven balance.
    const arDeltaByCustomer = {};
    for (const l of lines) {
      if (l.entity_type !== 'customer' || !l.entity_id || l.account_code !== '1100') continue;
      const delta = parseFloat(l.debit) - parseFloat(l.credit);
      arDeltaByCustomer[l.entity_id] = (arDeltaByCustomer[l.entity_id] || 0) + delta;
    }
    for (const [customerId, delta] of Object.entries(arDeltaByCustomer)) {
      if (Math.abs(delta) < 0.005) continue;
      await client.query(
        `UPDATE customers SET credit_balance = credit_balance + $3, updated_at = now()
         WHERE company_id = $1 AND customer_id = $2`,
        [companyId, customerId, delta]
      );
    }
  });
  return getJournal(companyId, journalId);
}

// ── Patch date only (works on posted journals to correct timezone errors) ─────
async function patchJournalDate(companyId, journalId, entryDate) {
  const dateStr = toDateStr(entryDate);
  const { rows: [j] } = await query(
    `SELECT status, ledger_entry_id FROM journals WHERE journal_id = $1 AND company_id = $2`,
    [journalId, companyId]
  );
  if (!j) throw AppError.notFound('Journal');
  if (j.status === 'void') throw AppError.conflict('Cannot change date on a reversed journal');

  await transaction(async (client) => {
    await client.query(
      `UPDATE journals SET entry_date = $1, updated_at = now() WHERE journal_id = $2`,
      [dateStr, journalId]
    );
    if (j.ledger_entry_id) {
      await client.query(
        `UPDATE journal_entries SET entry_date = $1 WHERE journal_entry_id = $2`,
        [dateStr, j.ledger_entry_id]
      );
    }
  });
  return getJournal(companyId, journalId);
}

// ── Void ──────────────────────────────────────────────────────────────────────

async function voidJournal(companyId, journalId, userId, reason) {
  return transaction(async (client) => {
    const { rows: [j] } = await client.query(
      `SELECT * FROM journals WHERE journal_id = $1 AND company_id = $2 FOR UPDATE`,
      [journalId, companyId]
    );
    if (!j) throw AppError.notFound('Journal');
    if (j.status === 'void') throw AppError.conflict('Journal is already reversed');

    if (j.status === 'draft') {
      await client.query(`DELETE FROM journals WHERE journal_id = $1`, [journalId]);
      return { voided: true, deleted: true };
    }

    // Posted — void the ledger entry and post a reversal
    await client.query(`
      UPDATE journal_entries
      SET status = 'void', voided_by_user_id = $1, voided_at = now(), void_reason = $2
      WHERE journal_entry_id = $3
    `, [userId, reason || null, j.ledger_entry_id]);

    const { rows: origLines } = await client.query(
      `SELECT lel.account_id, lel.debit, lel.credit, lel.description, lel.entity_type, lel.entity_id, a.account_code
       FROM ledger_entry_lines lel JOIN accounts a ON a.account_id = lel.account_id
       WHERE lel.journal_entry_id = $1`,
      [j.ledger_entry_id]
    );

    await _post(client, companyId, {
      entryDate:   toDateStr(new Date()),
      description: `Reversal of ${j.journal_number}${reason ? ': ' + reason : ''}`,
      sourceType:  'VOID',
      sourceId:    j.ledger_entry_id,
      userId,
      lines: origLines.map((l) => ({
        accountId:   l.account_id,
        debit:       parseFloat(l.credit),
        credit:      parseFloat(l.debit),
        description: l.description,
        entityType:  l.entity_type,
        entityId:    l.entity_id,
      })),
    });

    // Undo whatever this journal did to a customer's AR balance when it was posted
    // (see postJournal above) — otherwise voiding leaves credit_balance permanently
    // drifted by the original delta.
    const arDeltaByCustomer = {};
    for (const l of origLines) {
      if (l.entity_type !== 'customer' || !l.entity_id || l.account_code !== '1100') continue;
      const originalDelta = parseFloat(l.debit) - parseFloat(l.credit);
      arDeltaByCustomer[l.entity_id] = (arDeltaByCustomer[l.entity_id] || 0) - originalDelta;
    }
    for (const [customerId, delta] of Object.entries(arDeltaByCustomer)) {
      if (Math.abs(delta) < 0.005) continue;
      await client.query(
        `UPDATE customers SET credit_balance = credit_balance + $3, updated_at = now()
         WHERE company_id = $1 AND customer_id = $2`,
        [companyId, customerId, delta]
      );
    }

    await client.query(`
      UPDATE journals
      SET status = 'void', voided_by_user_id = $1, voided_at = now(), void_reason = $2, updated_at = now()
      WHERE journal_id = $3
    `, [userId, reason || null, journalId]);

    return { voided: true };
  });
}

// ── Bulk Import (from Excel) ──────────────────────────────────────────────────

async function bulkImportJournals(companyId, userId, entries) {
  if (!entries?.length) throw AppError.badRequest('No entries provided');

  return transaction(async (client) => {
    const allCodes = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.accountCode)))];
    if (!allCodes.length) throw AppError.badRequest('No account lines found');

    const { rows: accs } = await client.query(
      `SELECT account_code, account_id FROM accounts
       WHERE company_id = $1 AND account_code = ANY($2) AND is_active = TRUE`,
      [companyId, allCodes]
    );
    const codeMap = Object.fromEntries(accs.map((a) => [a.account_code, a.account_id]));

    const missing = allCodes.filter((c) => !codeMap[c]);
    if (missing.length) throw AppError.badRequest(`Unknown/inactive account codes: ${missing.join(', ')}`);

    let imported = 0;
    for (const entry of entries) {
      const journalNumber = await nextJournalNumber(client, companyId);
      const entryDate     = toDateStr(entry.entryDate);

      const lines = entry.lines.map((l) => ({
        accountId:   codeMap[l.accountCode],
        debit:       parseFloat(l.debit  || 0),
        credit:      parseFloat(l.credit || 0),
        description: l.description || null,
        entityType:  null,
        entityId:    null,
      }));

      const { rows: [j] } = await client.query(`
        INSERT INTO journals
          (company_id, journal_number, entry_date, description, created_by_user_id, status)
        VALUES ($1, $2, $3, $4, $5, 'draft')
        RETURNING journal_id
      `, [companyId, journalNumber, entryDate, entry.description || 'Imported entry', userId]);

      await insertLines(client, j.journal_id, lines);

      const ledgerEntryId = await _post(client, companyId, {
        entryDate,
        description: entry.description || 'Imported entry',
        sourceType:  'MANUAL',
        sourceId:    j.journal_id,
        userId,
        lines,
      });

      await client.query(`
        UPDATE journals
        SET status = 'posted', ledger_entry_id = $1, posted_by_user_id = $2, posted_at = now()
        WHERE journal_id = $3
      `, [ledgerEntryId, userId, j.journal_id]);

      imported++;
    }
    return { imported };
  });
}

module.exports = {
  listJournals, getJournal,
  createJournal, updateJournal, patchJournalDate,
  postJournal, voidJournal,
  bulkImportJournals,
};
