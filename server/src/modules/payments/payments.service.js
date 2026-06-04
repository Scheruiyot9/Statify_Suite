const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const jrn = require('../journal/journal.service');

async function nextPaymentNumber(client, companyId) {
  const { rows: [{ payment_counter }] } = await client.query(
    `UPDATE companies SET payment_counter = payment_counter + 1
     WHERE company_id = $1 RETURNING payment_counter`,
    [companyId]
  );
  return `PAY-${new Date().getFullYear()}-${String(payment_counter).padStart(5, '0')}`;
}

async function listPayments(companyId, { supplierId, fromDate, toDate, page = 1, limit = 25 } = {}) {
  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const conds = ['sp.company_id = $1', 'sp.is_void = FALSE'];
  const vals  = [companyId];

  if (supplierId) { vals.push(supplierId); conds.push(`sp.supplier_id = $${vals.length}`); }
  if (fromDate)   { vals.push(fromDate);   conds.push(`sp.payment_date >= $${vals.length}`); }
  if (toDate)     { vals.push(toDate);     conds.push(`sp.payment_date <= $${vals.length}`); }

  vals.push(lm, (pg - 1) * lm);
  const { rows } = await query(`
    SELECT sp.payment_id, sp.payment_number, sp.payment_type, sp.payment_date,
           sp.amount, sp.payment_method, sp.reference_number, sp.notes,
           sp.payee_name, sp.created_at,
           s.supplier_name, s.supplier_id,
           b.branch_name,
           ba.account_name AS bank_account_name,
           ea.account_name AS expense_account_name,
           po.po_number,
           u.first_name || ' ' || u.last_name AS created_by,
           COUNT(*) OVER() AS total_count
    FROM supplier_payments sp
    LEFT JOIN suppliers      s  ON s.supplier_id       = sp.supplier_id
    JOIN  branches           b  ON b.branch_id         = sp.branch_id
    LEFT JOIN bank_accounts  ba ON ba.bank_account_id  = sp.bank_account_id
    LEFT JOIN accounts       ea ON ea.account_id       = sp.expense_account_id
    LEFT JOIN purchase_orders po ON po.po_id           = sp.po_id
    LEFT JOIN users          u  ON u.user_id           = sp.created_by_user_id
    WHERE ${conds.join(' AND ')}
    ORDER BY sp.payment_date DESC, sp.created_at DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return { payments: rows.map(({ total_count, ...r }) => r), total, page: pg, limit: lm, pages: Math.ceil(total / lm) };
}

async function getPayment(companyId, paymentId) {
  const { rows: [payment] } = await query(`
    SELECT sp.*,
           s.supplier_name, s.email AS supplier_email, s.phone AS supplier_phone,
           b.branch_name,
           ba.account_name AS bank_account_name, ba.bank_name, ba.account_number,
           ea.account_name AS expense_account_name,
           po.po_number,
           u.first_name || ' ' || u.last_name AS created_by
    FROM supplier_payments sp
    LEFT JOIN suppliers      s  ON s.supplier_id      = sp.supplier_id
    JOIN  branches           b  ON b.branch_id        = sp.branch_id
    LEFT JOIN bank_accounts  ba ON ba.bank_account_id = sp.bank_account_id
    LEFT JOIN accounts       ea ON ea.account_id      = sp.expense_account_id
    LEFT JOIN purchase_orders po ON po.po_id          = sp.po_id
    LEFT JOIN users          u  ON u.user_id          = sp.created_by_user_id
    WHERE sp.payment_id = $1 AND sp.company_id = $2
  `, [paymentId, companyId]);
  if (!payment) throw AppError.notFound('Payment');
  return payment;
}

async function createPayment(companyId, userId, data) {
  const {
    branch_id, payment_type = 'supplier',
    supplier_id, bank_account_id, po_id,
    expense_lines = [],
    payment_date, payment_method, reference_number, notes,
  } = data;

  if (!branch_id) throw AppError.badRequest('branch_id is required');

  if (payment_type === 'supplier') {
    if (!supplier_id) throw AppError.badRequest('supplier_id is required for supplier payments');
    const amt = parseFloat(data.amount);
    if (!amt || amt <= 0) throw AppError.badRequest('Amount must be greater than zero');

    const { rows: [supplier] } = await query(
      `SELECT supplier_id FROM suppliers WHERE supplier_id=$1 AND company_id=$2`,
      [supplier_id, companyId]
    );
    if (!supplier) throw AppError.notFound('Supplier');

    if (po_id) {
      const { rows: [po] } = await query(
        `SELECT po_id FROM purchase_orders WHERE po_id=$1 AND company_id=$2 AND supplier_id=$3`,
        [po_id, companyId, supplier_id]
      );
      if (!po) throw AppError.badRequest('PO not found or does not belong to this supplier');
    }
  } else {
    if (!expense_lines.length) throw AppError.badRequest('At least one expense line is required');
    for (const l of expense_lines) {
      if (!l.accountId) throw AppError.badRequest('Each expense line requires an account');
      if (!parseFloat(l.amount) || parseFloat(l.amount) <= 0)
        throw AppError.badRequest('Each expense line requires a positive amount');
      const { rows: [acc] } = await query(
        `SELECT account_id FROM accounts WHERE account_id=$1 AND company_id=$2 AND is_active=TRUE`,
        [l.accountId, companyId]
      );
      if (!acc) throw AppError.badRequest(`Account not found or inactive: ${l.accountId}`);
    }
  }

  if (bank_account_id) {
    const { rows: [ba] } = await query(
      `SELECT bank_account_id FROM bank_accounts WHERE bank_account_id=$1 AND company_id=$2`,
      [bank_account_id, companyId]
    );
    if (!ba) throw AppError.badRequest('Bank account not found');
  }

  return transaction(async (client) => {
    const paymentNumber = await nextPaymentNumber(client, companyId);

    const totalAmount = payment_type === 'supplier'
      ? parseFloat(data.amount)
      : expense_lines.reduce((s, l) => s + parseFloat(l.amount), 0);

    const { rows: [payment] } = await client.query(`
      INSERT INTO supplier_payments
        (company_id, branch_id, supplier_id, bank_account_id, po_id,
         expense_lines, payment_type, payment_number,
         payment_date, amount, payment_method, reference_number, notes, created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [companyId, branch_id,
        supplier_id || null, bank_account_id || null, po_id || null,
        JSON.stringify(expense_lines),
        payment_type, paymentNumber,
        payment_date || new Date().toISOString().slice(0, 10),
        totalAmount, payment_method || 'bank_transfer',
        reference_number || null, notes || null, userId]);

    if (payment_type === 'supplier') {
      await jrn.postPaymentEntry(client, companyId, payment);
    } else {
      await jrn.postDirectExpenseEntry(client, companyId, payment);
    }

    return payment;
  });
}

async function voidPayment(companyId, paymentId, userId) {
  const { rows: [payment] } = await query(
    `SELECT * FROM supplier_payments WHERE payment_id=$1 AND company_id=$2`,
    [paymentId, companyId]
  );
  if (!payment) throw AppError.notFound('Payment');
  if (payment.is_void) throw AppError.conflict('Payment is already voided');

  return transaction(async (client) => {
    await client.query(`
      UPDATE supplier_payments
      SET is_void=TRUE, voided_at=now(), voided_by_user_id=$2
      WHERE payment_id=$1
    `, [paymentId, userId]);

    if (payment.payment_type === 'direct') {
      await jrn.postVoidDirectExpenseEntry(client, companyId, payment, userId);
    } else {
      await jrn.postVoidPaymentEntry(client, companyId, payment, userId);
    }

    return { payment_id: paymentId, voided: true };
  });
}

module.exports = { listPayments, getPayment, createPayment, voidPayment };
