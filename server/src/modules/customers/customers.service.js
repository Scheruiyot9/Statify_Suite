const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const QueryBuilder = require('../../shared/qb');
const { postCreditReceiptEntry } = require('../journal/journal.service');

// Normalize Kenyan phone to 07XXXXXXXX / 01XXXXXXXX local format
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).trim().replace(/[\s\-().]/g, '');
  if (p.startsWith('+254')) p = '0' + p.slice(4);
  else if (/^254\d{9}$/.test(p)) p = '0' + p.slice(3);
  return p || null;
}

async function listCustomers(companyId, { search, groupId, phone, customerId, creditOutstanding, page = 1, limit = 25 } = {}) {
  const qb = new QueryBuilder([companyId]);
  const conditions = ['c.company_id = $1', 'c.deleted_at IS NULL'];
  if (creditOutstanding === 'true') conditions.push('c.credit_balance > 0');

  if (search) {
    const p = qb.add(`%${search}%`);
    conditions.push(
      `(c.customer_name ILIKE $${p} OR c.phone ILIKE $${p} OR c.email ILIKE $${p} OR c.customer_code ILIKE $${p} OR c.id_number ILIKE $${p})`
    );
  }

  if (phone) {
    const normPhone = normalizePhone(phone);
    const phonePat  = qb.add('%' + (normPhone || phone) + '%');
    conditions.push(`c.phone ILIKE $${phonePat}`);
  }
  if (customerId) {
    conditions.push(`c.id_number ILIKE $${qb.add('%' + customerId.trim() + '%')}`);
  }

  if (groupId) {
    conditions.push(`c.customer_group_id = $${qb.add(groupId)}`);
  }

  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const limIdx  = qb.add(lm);
  const offIdx  = qb.add((pg - 1) * lm);

  const { rows } = await query(`
    SELECT
      c.customer_id, c.customer_name, c.customer_code, c.phone, c.email,
      c.customer_group_id, c.loyalty_points_balance, c.credit_balance,
      c.allow_credit, c.credit_limit,
      c.kra_pin, c.id_number,
      c.created_at,
      cg.group_name,
      (SELECT COUNT(*) FROM sales_transactions st
       WHERE st.customer_id = c.customer_id AND st.status = 'completed') AS purchase_count,
      (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM sales_transactions st
       WHERE st.customer_id = c.customer_id AND st.status = 'completed') AS total_spent,
      COUNT(*) OVER() AS total_count
    FROM customers c
    LEFT JOIN customer_groups cg ON cg.group_id = c.customer_group_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.customer_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;

  return {
    customers: rows.map((r) => ({
      customer_id: r.customer_id,
      customer_name: r.customer_name,
      customer_code: r.customer_code,
      phone: r.phone,
      email: r.email,
      customer_group_id: r.customer_group_id,
      group_name: r.group_name,
      loyalty_points_balance: parseInt(r.loyalty_points_balance || 0),
      credit_balance: parseFloat(r.credit_balance || 0),
      allow_credit:   r.allow_credit ?? false,
      credit_limit:   parseFloat(r.credit_limit || 0),
      kra_pin:    r.kra_pin,
      id_number:  r.id_number,
      created_at: r.created_at,
      purchase_count: parseInt(r.purchase_count || 0),
      total_spent: parseFloat(r.total_spent || 0),
    })),
    total,
    page: pg,
    limit: lm,
    pages: Math.ceil(total / lm),
  };
}

async function getCustomer(companyId, customerId) {
  const { rows } = await query(`
    SELECT c.*, cg.group_name
    FROM customers c
    LEFT JOIN customer_groups cg ON cg.group_id = c.customer_group_id
    WHERE c.company_id = $1 AND c.customer_id = $2 AND c.deleted_at IS NULL
  `, [companyId, customerId]);
  if (!rows.length) throw AppError.notFound('Customer');

  const { rows: txns } = await query(`
    SELECT st.transaction_id, st.transaction_number, st.transaction_date,
           st.total_amount::numeric, st.status, st.is_credit_sale, st.payment_status, b.branch_name
    FROM sales_transactions st
    JOIN branches b ON b.branch_id = st.branch_id
    WHERE st.customer_id = $1
    ORDER BY st.transaction_date DESC
    LIMIT 10
  `, [customerId]);

  return { ...rows[0], recent_transactions: txns };
}

async function createCustomer(companyId, data) {
  const { customer_name, phone, email, customer_group_id, customer_code, date_of_birth, notes,
          kra_pin, id_number, allow_credit, credit_limit } = data;
  const code        = customer_code || await _generateCode(companyId);
  const normalPhone = normalizePhone(phone);

  // Fetch company credit settings to auto-apply defaults
  const { rows: coRows } = await query(
    `SELECT credit_sales_enabled, default_credit_limit FROM companies WHERE company_id = $1`,
    [companyId]
  );
  const creditEnabled        = coRows[0]?.credit_sales_enabled ?? false;
  const defaultCreditLimit   = parseFloat(coRows[0]?.default_credit_limit || 0);

  // When credit is enabled and caller didn't explicitly set allow_credit/credit_limit, auto-apply defaults
  const resolvedAllowCredit  = allow_credit  != null ? Boolean(allow_credit)              : creditEnabled;
  const resolvedCreditLimit  = credit_limit  != null ? parseFloat(credit_limit) || 0      :
                               (creditEnabled ? defaultCreditLimit : 0);

  // Duplicate checks
  if (normalPhone) {
    const { rows: dup } = await query(
      `SELECT 1 FROM customers WHERE company_id=$1 AND phone=$2 AND deleted_at IS NULL`,
      [companyId, normalPhone]
    );
    if (dup.length) throw AppError.conflict('A customer with this phone number already exists');
  }
  if (kra_pin?.trim()) {
    const { rows: dup } = await query(
      `SELECT 1 FROM customers WHERE company_id=$1 AND kra_pin=$2 AND deleted_at IS NULL`,
      [companyId, kra_pin.trim()]
    );
    if (dup.length) throw AppError.conflict('A customer with this KRA PIN already exists');
  }
  if (id_number?.trim()) {
    const { rows: dup } = await query(
      `SELECT 1 FROM customers WHERE company_id=$1 AND id_number=$2 AND deleted_at IS NULL`,
      [companyId, id_number.trim()]
    );
    if (dup.length) throw AppError.conflict('A customer with this ID number already exists');
  }

  const { rows } = await query(`
    INSERT INTO customers (
      company_id, customer_name, phone, email, customer_group_id,
      customer_code, date_of_birth, kra_pin, id_number, notes,
      allow_credit, credit_limit
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [companyId, customer_name, normalPhone, email || null,
    customer_group_id || null, code, date_of_birth || null,
    kra_pin?.trim() || null, id_number?.trim() || null, notes || null,
    resolvedAllowCredit, resolvedCreditLimit]);

  return rows[0];
}

async function updateCustomer(companyId, customerId, data) {
  const { customer_name, phone, email, customer_group_id, date_of_birth, notes,
          kra_pin, id_number, allow_credit, credit_limit } = data;
  const normalPhone = phone !== undefined ? normalizePhone(phone) : undefined;

  // Duplicate checks (exclude self)
  if (normalPhone) {
    const { rows: dup } = await query(
      `SELECT 1 FROM customers WHERE company_id=$1 AND phone=$2 AND customer_id!=$3 AND deleted_at IS NULL`,
      [companyId, normalPhone, customerId]
    );
    if (dup.length) throw AppError.conflict('A customer with this phone number already exists');
  }
  if (kra_pin?.trim()) {
    const { rows: dup } = await query(
      `SELECT 1 FROM customers WHERE company_id=$1 AND kra_pin=$2 AND customer_id!=$3 AND deleted_at IS NULL`,
      [companyId, kra_pin.trim(), customerId]
    );
    if (dup.length) throw AppError.conflict('A customer with this KRA PIN already exists');
  }
  if (id_number?.trim()) {
    const { rows: dup } = await query(
      `SELECT 1 FROM customers WHERE company_id=$1 AND id_number=$2 AND customer_id!=$3 AND deleted_at IS NULL`,
      [companyId, id_number.trim(), customerId]
    );
    if (dup.length) throw AppError.conflict('A customer with this ID number already exists');
  }

  const { rows } = await query(`
    UPDATE customers
    SET customer_name     = COALESCE($3,  customer_name),
        phone             = COALESCE($4,  phone),
        email             = COALESCE($5,  email),
        customer_group_id = COALESCE($6,  customer_group_id),
        date_of_birth     = COALESCE($7,  date_of_birth),
        kra_pin           = COALESCE($8,  kra_pin),
        id_number         = COALESCE($9,  id_number),
        notes             = COALESCE($10, notes),
        allow_credit      = COALESCE($11, allow_credit),
        credit_limit      = COALESCE($12, credit_limit),
        updated_at        = now()
    WHERE company_id = $1 AND customer_id = $2 AND deleted_at IS NULL
    RETURNING *
  `, [companyId, customerId,
    customer_name ?? null, normalPhone ?? null, email ?? null,
    customer_group_id ?? null, date_of_birth ?? null,
    kra_pin?.trim() || null, id_number?.trim() || null, notes ?? null,
    allow_credit ?? null, credit_limit != null ? parseFloat(credit_limit) : null]);

  if (!rows.length) throw AppError.notFound('Customer');
  return rows[0];
}

async function listGroups(companyId) {
  const { rows } = await query(
    `SELECT group_id, group_name, default_discount_type, default_discount_value FROM customer_groups WHERE company_id = $1 AND is_active = TRUE ORDER BY group_name`,
    [companyId]
  );
  return rows;
}

async function createGroup(companyId, { group_name, default_discount_value }) {
  const { rows } = await query(`
    INSERT INTO customer_groups (company_id, group_name, default_discount_type, default_discount_value)
    VALUES ($1, $2, $3, $4) RETURNING *
  `, [companyId, group_name, default_discount_value > 0 ? 'percentage' : 'none', default_discount_value || 0]);
  return rows[0];
}

async function updateGroup(companyId, groupId, { group_name, default_discount_value }) {
  const { rows } = await query(`
    UPDATE customer_groups
    SET group_name             = COALESCE($3, group_name),
        default_discount_value = COALESCE($4, default_discount_value),
        default_discount_type  = CASE WHEN $4 > 0 THEN 'percentage' ELSE 'none' END,
        updated_at             = now()
    WHERE company_id = $1 AND group_id = $2
    RETURNING *
  `, [companyId, groupId, group_name ?? null, default_discount_value ?? null]);
  if (!rows.length) throw AppError.notFound('Customer group');
  return rows[0];
}

async function _generateCode(companyId) {
  const { rows } = await query(`SELECT COUNT(*) AS cnt FROM customers WHERE company_id = $1`, [companyId]);
  return `CUST-${String(parseInt(rows[0].cnt) + 1).padStart(5, '0')}`;
}

async function getCustomerLedger(companyId, customerId) {
  const { rows: [cust] } = await query(
    `SELECT customer_id, customer_name, credit_balance, credit_limit, allow_credit
     FROM customers WHERE company_id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
    [companyId, customerId]
  );
  if (!cust) throw AppError.notFound('Customer');

  let salesRes, paymentsRes;

  try {
    salesRes = await query(`
      SELECT st.transaction_id, st.transaction_number, st.transaction_date,
             st.total_amount::numeric, st.payment_status,
             COALESCE(json_agg(
               json_build_object('name', p.product_name, 'qty', sti.quantity)
               ORDER BY sti.item_id
             ) FILTER (WHERE p.product_name IS NOT NULL), '[]') AS items
      FROM sales_transactions st
      LEFT JOIN sales_transaction_items sti ON sti.transaction_id = st.transaction_id
      LEFT JOIN products p ON p.product_id = sti.product_id
      WHERE st.customer_id = $2 AND st.company_id = $1
        AND st.is_credit_sale = TRUE AND st.status = 'completed'
      GROUP BY st.transaction_id, st.transaction_number, st.transaction_date,
               st.total_amount, st.payment_status
      ORDER BY st.transaction_date ASC
    `, [companyId, customerId]);
  } catch (err) {
    console.error('[getCustomerLedger] sales query failed:', err.message);
    throw err;
  }

  try {
    paymentsRes = await query(`
      SELECT je.journal_entry_id, je.entry_date, je.description,
             jel.credit::numeric AS amount
      FROM journal_entries je
      JOIN ledger_entry_lines jel ON jel.journal_entry_id = je.journal_entry_id
      WHERE je.company_id = $1 AND je.source_type = 'CREDIT_PAYMENT'
        AND jel.entity_id = $2
        AND jel.credit > 0 AND je.status = 'posted'
      ORDER BY je.entry_date ASC
    `, [companyId, customerId]);
  } catch (err) {
    console.error('[getCustomerLedger] payments query failed:', err.message);
    paymentsRes = { rows: [] };   // degrade gracefully — show sales even if payments fail
  }

  // Aging from unpaid/partial sales
  const today = new Date();
  const aging = { current: 0, days30: 0, days60: 0, days90plus: 0 };
  for (const r of salesRes.rows) {
    if (r.payment_status === 'paid') continue;
    const days = Math.floor((today - new Date(r.transaction_date)) / 86400000);
    const amt  = parseFloat(r.total_amount);
    if      (days <= 30) aging.current    += amt;
    else if (days <= 60) aging.days30     += amt;
    else if (days <= 90) aging.days60     += amt;
    else                 aging.days90plus += amt;
  }

  const activity = [
    ...salesRes.rows.map((r) => ({
      type:           'SALE',
      id:             r.transaction_id,
      ref:            r.transaction_number,
      date:           r.transaction_date,
      amount:         parseFloat(r.total_amount),
      payment_status: r.payment_status,
      items:          r.items,
    })),
    ...paymentsRes.rows.map((r) => ({
      type:   'PAYMENT',
      id:     r.journal_entry_id,
      ref:    r.description,
      date:   r.entry_date,
      amount: parseFloat(r.amount),
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    customer: {
      customer_id:    cust.customer_id,
      customer_name:  cust.customer_name,
      credit_balance: parseFloat(cust.credit_balance ?? 0),
      credit_limit:   parseFloat(cust.credit_limit   ?? 0),
    },
    aging: {
      current:    +aging.current.toFixed(2),
      days30:     +aging.days30.toFixed(2),
      days60:     +aging.days60.toFixed(2),
      days90plus: +aging.days90plus.toFixed(2),
    },
    activity,
  };
}

async function listCreditTransactions(companyId, customerId) {
  const { rows } = await query(`
    SELECT st.transaction_id, st.transaction_number, st.transaction_date,
           st.total_amount, st.payment_status,
           COALESCE(
             json_agg(
               json_build_object('name', p.product_name, 'qty', sti.quantity)
               ORDER BY sti.item_id
             ) FILTER (WHERE p.product_name IS NOT NULL),
             '[]'
           ) AS items
    FROM sales_transactions st
    LEFT JOIN sales_transaction_items sti ON sti.transaction_id = st.transaction_id
    LEFT JOIN products p ON p.product_id = sti.product_id
    WHERE st.customer_id = $2 AND st.company_id = $1
      AND st.is_credit_sale = TRUE AND st.status = 'completed'
    GROUP BY st.transaction_id
    ORDER BY st.transaction_date DESC
    LIMIT 100
  `, [companyId, customerId]);
  return rows.map((r) => ({
    ...r,
    total_amount: parseFloat(r.total_amount),
  }));
}

async function recordCreditPayment(companyId, customerId, amount, paymentMethodId, sessionId = null, transactionIds = null) {
  if (!amount || amount <= 0) throw AppError.badRequest('Payment amount must be positive');

  return transaction(async (client) => {
    const { rows: custRows } = await client.query(`
      SELECT credit_balance, customer_name FROM customers
      WHERE company_id = $1 AND customer_id = $2 AND deleted_at IS NULL FOR UPDATE
    `, [companyId, customerId]);
    if (!custRows.length) throw AppError.notFound('Customer');

    const currentBalance = parseFloat(custRows[0].credit_balance);
    const customerName   = custRows[0].customer_name;
    // Overpayment: excess stored as negative balance (advance credit for future purchases)
    const advanceCredit  = amount > currentBalance ? +(amount - currentBalance).toFixed(2) : 0;

    // Reduce credit balance — allow going negative for advance credit
    const { rows: updated } = await client.query(`
      UPDATE customers
      SET credit_balance = credit_balance - $3, updated_at = now()
      WHERE company_id = $1 AND customer_id = $2
      RETURNING customer_id, customer_name, credit_balance, credit_limit
    `, [companyId, customerId, amount]);

    // Mark transactions as paid: use caller-specified IDs or fall back to FIFO
    let txnQuery, txnParams;
    if (transactionIds && transactionIds.length > 0) {
      txnQuery  = `SELECT transaction_id, total_amount FROM sales_transactions
                   WHERE customer_id = $1 AND transaction_id = ANY($2::uuid[])
                     AND is_credit_sale = TRUE AND payment_status IN ('partial','unpaid') AND status = 'completed'
                   ORDER BY transaction_date ASC`;
      txnParams = [customerId, transactionIds];
    } else {
      txnQuery  = `SELECT transaction_id, total_amount FROM sales_transactions
                   WHERE customer_id = $1 AND is_credit_sale = TRUE
                     AND payment_status IN ('partial','unpaid') AND status = 'completed'
                   ORDER BY transaction_date ASC`;
      txnParams = [customerId];
    }
    const { rows: txns } = await client.query(txnQuery, txnParams);

    // Only apply up to the actual balance (advance credit doesn't clear extra invoices)
    let remaining = Math.min(amount, currentBalance);
    for (const txn of txns) {
      if (remaining <= 0.005) break;
      const txnAmt = parseFloat(txn.total_amount);
      if (remaining >= txnAmt - 0.005) {
        await client.query(
          `UPDATE sales_transactions SET payment_status = 'paid', updated_at = now() WHERE transaction_id = $1`,
          [txn.transaction_id]
        );
        remaining -= txnAmt;
      } else {
        // Partial coverage of this transaction — leave as 'partial' (balance already reduced)
        break;
      }
    }

    // Post journal entry: DR Cash/Bank  CR AR (1100)
    await postCreditReceiptEntry(client, companyId, {
      customerId, customerName, amount, paymentMethodId,
    });

    return {
      customer_id:    updated[0].customer_id,
      customer_name:  updated[0].customer_name,
      credit_balance: parseFloat(updated[0].credit_balance),
      credit_limit:   parseFloat(updated[0].credit_limit),
      amount_paid:    amount,
      advance_credit: advanceCredit,
    };
  });
}

async function recalculateCreditBalance(companyId, customerId) {
  // Derive credit_balance from the AR ledger (account 1100) for this customer.
  // The ledger is always authoritative — credit sales DR the AR account and
  // credit payments CR it; the net is the true outstanding balance.
  const { rows } = await query(`
    WITH ar_account AS (
      SELECT account_id FROM accounts
      WHERE company_id = $1 AND account_code = '1100' LIMIT 1
    )
    UPDATE customers SET
      credit_balance = (
        SELECT COALESCE(SUM(lel.debit - lel.credit), 0)
        FROM ledger_entry_lines lel
        JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
        WHERE lel.account_id = (SELECT account_id FROM ar_account)
          AND lel.entity_id  = $2
          AND je.company_id  = $1
      ),
      updated_at = now()
    WHERE customer_id = $2 AND company_id = $1
    RETURNING customer_id, customer_name, credit_balance, credit_limit
  `, [companyId, customerId]);

  if (!rows.length) throw new Error('Customer not found');
  return {
    customer_id:    rows[0].customer_id,
    customer_name:  rows[0].customer_name,
    credit_balance: parseFloat(rows[0].credit_balance),
    credit_limit:   parseFloat(rows[0].credit_limit),
  };
}

async function deleteCustomer(companyId, customerId, deletedBy) {
  const { rows: txns } = await query(`
    SELECT 1 FROM sales_transactions
    WHERE customer_id = $1 AND status NOT IN ('void', 'refund') LIMIT 1
  `, [customerId]);

  if (txns.length)
    throw AppError.badRequest(
      'Cannot delete a customer with active transactions. Deactivate instead.'
    );

  const { rows } = await query(`
    UPDATE customers
    SET deleted_at = now(), deleted_by = $3, updated_at = now()
    WHERE company_id = $1 AND customer_id = $2 AND deleted_at IS NULL
    RETURNING customer_id
  `, [companyId, customerId, deletedBy]);

  if (!rows.length) throw AppError.notFound('Customer');
}

module.exports = {
  listCustomers, getCustomer, createCustomer, updateCustomer, listGroups, createGroup, updateGroup,
  listCreditTransactions, recordCreditPayment, recalculateCreditBalance, deleteCustomer, getCustomerLedger,
};
