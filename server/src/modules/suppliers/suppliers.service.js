const { query } = require('../../config/database');
const AppError  = require('../../shared/AppError');

// Always compute live from the ledger — every GRN/payment/manual entry is tagged
// entity_type='supplier', so credits minus debits gives the outstanding AP balance.
// Falls back to 0 when no ledger entries exist yet.
const LIVE_BALANCE_SQL = `
  COALESCE((
    SELECT (SUM(lel.credit) - SUM(lel.debit))::numeric
    FROM ledger_entry_lines lel
    JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
    WHERE je.status = 'posted' AND je.source_type != 'VOID'
      AND lel.entity_type = 'supplier'
      AND lel.entity_id = s.supplier_id
  ), 0) AS current_balance
`;

async function listSuppliers(companyId, { search = '', page = 1, limit = 25, active } = {}) {
  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const conditions = ['s.company_id = $1'];
  const vals = [companyId];

  if (search) {
    vals.push(`%${search}%`);
    conditions.push(`(s.supplier_name ILIKE $${vals.length} OR s.email ILIKE $${vals.length} OR s.phone ILIKE $${vals.length})`);
  }
  if (active !== undefined) {
    vals.push(active === 'true' || active === true);
    conditions.push(`s.is_active = $${vals.length}`);
  }

  vals.push(lm, (pg - 1) * lm);
  const { rows } = await query(`
    SELECT s.supplier_id, s.company_id, s.supplier_name, s.contact_person,
           s.email, s.phone, s.address, s.tax_pin, s.payment_terms,
           s.credit_limit, s.account_id, s.currency, s.notes,
           s.is_active, s.created_at, s.updated_at,
           a.account_name AS coa_account_name,
           ${LIVE_BALANCE_SQL},
           COUNT(*) OVER() AS total_count
    FROM suppliers s
    LEFT JOIN accounts a ON a.account_id = s.account_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.supplier_name
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    suppliers: rows.map(({ total_count, ...r }) => r),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

async function getSupplier(companyId, supplierId) {
  const { rows } = await query(`
    SELECT s.supplier_id, s.company_id, s.supplier_name, s.contact_person,
           s.email, s.phone, s.address, s.tax_pin, s.payment_terms,
           s.credit_limit, s.account_id, s.currency, s.notes,
           s.is_active, s.created_at, s.updated_at,
           a.account_name AS coa_account_name,
           ${LIVE_BALANCE_SQL}
    FROM suppliers s
    LEFT JOIN accounts a ON a.account_id = s.account_id
    WHERE s.supplier_id = $1 AND s.company_id = $2
  `, [supplierId, companyId]);
  if (!rows.length) throw AppError.notFound('Supplier');
  return rows[0];
}

async function createSupplier(companyId, data) {
  const { supplier_name, contact_person, email, phone, address,
          tax_pin, payment_terms = 30, credit_limit,
          account_id, currency = 'KES', notes } = data;

  if (!supplier_name) throw AppError.badRequest('supplier_name is required');

  const { rows } = await query(`
    INSERT INTO suppliers
      (company_id, supplier_name, contact_person, email, phone, address,
       tax_pin, payment_terms, credit_limit, account_id, currency, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [companyId, supplier_name.trim(), contact_person || null, email || null,
      phone || null, address || null, tax_pin || null,
      parseInt(payment_terms) || 30, credit_limit || null,
      account_id || null, currency, notes || null]);

  return rows[0];
}

async function updateSupplier(companyId, supplierId, data) {
  const allowed = ['supplier_name','contact_person','email','phone','address',
                   'tax_pin','payment_terms','credit_limit','account_id',
                   'currency','notes','is_active'];
  const sets = [];
  const vals = [companyId, supplierId];

  for (const [k, v] of Object.entries(data)) {
    if (!allowed.includes(k)) continue;
    vals.push(v === '' ? null : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) throw AppError.badRequest('No valid fields to update');

  const { rows } = await query(`
    UPDATE suppliers SET ${sets.join(', ')}, updated_at = now()
    WHERE company_id = $1 AND supplier_id = $2
    RETURNING *
  `, vals);
  if (!rows.length) throw AppError.notFound('Supplier');
  return rows[0];
}

async function deleteSupplier(companyId, supplierId) {
  const { rows: sup } = await query(
    `SELECT s.supplier_id,
            COALESCE((
              SELECT (SUM(lel.credit) - SUM(lel.debit))::numeric
              FROM ledger_entry_lines lel
              JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
              WHERE je.status = 'posted'
                AND lel.entity_type = 'supplier'
                AND lel.entity_id = s.supplier_id
            ), 0) AS current_balance
     FROM suppliers s WHERE s.supplier_id = $1 AND s.company_id = $2`,
    [supplierId, companyId]
  );
  if (!sup.length) throw AppError.notFound('Supplier');
  if (parseFloat(sup[0].current_balance) !== 0)
    throw AppError.conflict('Cannot deactivate a supplier with an outstanding balance');

  await query(
    `UPDATE suppliers SET is_active = FALSE, updated_at = now() WHERE supplier_id = $1`,
    [supplierId]
  );
  return { deleted: true };
}

async function getSupplierLedger(companyId, supplierId, { startDate, endDate, page = 1, limit = 30 } = {}) {
  const pg = parseInt(page,  10);
  const lm = parseInt(limit, 10);

  // verify supplier belongs to company
  const { rows: [sup] } = await query(
    `SELECT supplier_id, supplier_name FROM suppliers WHERE supplier_id = $1 AND company_id = $2`,
    [supplierId, companyId]
  );
  if (!sup) throw AppError.notFound('Supplier');

  const vals  = [companyId, supplierId];
  const conds = ['je.company_id = $1', "je.status IN ('posted', 'void')",
                 'lel.entity_type = \'supplier\'', 'lel.entity_id = $2'];

  if (startDate) { vals.push(startDate); conds.push(`je.entry_date >= $${vals.length}`); }
  if (endDate)   { vals.push(endDate);   conds.push(`je.entry_date <= $${vals.length}`); }

  vals.push(lm, (pg - 1) * lm);

  const { rows } = await query(`
    WITH base AS (
      SELECT je.journal_entry_id, je.entry_number, je.entry_date, je.description,
             je.source_type, je.source_id, je.status, je.created_at,
             SUM(lel.debit)::numeric  AS debit,
             SUM(lel.credit)::numeric AS credit
      FROM ledger_entry_lines lel
      JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
      WHERE ${conds.join(' AND ')}
      GROUP BY je.journal_entry_id, je.entry_number, je.entry_date,
               je.description, je.source_type, je.source_id, je.status, je.created_at
    )
    SELECT *, COUNT(*) OVER() AS total_count
    FROM base
    ORDER BY entry_date DESC, created_at DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    entries: rows.map(({ total_count, ...r }) => ({
      entryId:     r.journal_entry_id,
      entryNumber: r.entry_number,
      entryDate:   r.entry_date,
      description: r.description,
      sourceType:  r.source_type,
      sourceId:    r.source_id,
      status:      r.status,
      debit:       parseFloat(r.debit),
      credit:      parseFloat(r.credit),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

module.exports = { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, getSupplierLedger };
