const { query } = require('../../config/database');
const AppError = require('../../shared/AppError');
const productsService = require('../products/products.service');
const QueryBuilder = require('../../shared/qb');

// ── POS Product Catalog ───────────────────────────────────────────────────────

async function listSellableProducts(companyId, { branchId, search, categoryId, page, limit } = {}) {
  if (!branchId) throw AppError.badRequest('branchId is required');
  return productsService.listProducts(companyId, {
    branchId,
    search,
    categoryId,
    page,
    limit,
  });
}

// ── Payment Methods ───────────────────────────────────────────────────────────

async function listPaymentMethods(companyId, includeInactive = false) {
  const { rows } = await query(
    `SELECT pm.payment_method_id, pm.method_name, pm.is_active, pm.requires_reference,
            pm.bank_account_id, ba.account_name AS bank_account_name, ba.bank_name
     FROM payment_methods pm
     LEFT JOIN bank_accounts ba ON ba.bank_account_id = pm.bank_account_id
     WHERE pm.company_id = $1 ${includeInactive ? '' : 'AND pm.is_active = TRUE'}
     ORDER BY pm.method_name`,
    [companyId]
  );
  return rows;
}

async function createPaymentMethod(companyId, { methodName, requiresReference = false, bankAccountId }) {
  const { rows } = await query(`
    INSERT INTO payment_methods (company_id, method_name, requires_reference, bank_account_id)
    VALUES ($1, $2, $3, $4)
    RETURNING payment_method_id, method_name, is_active, requires_reference, bank_account_id
  `, [companyId, methodName.trim(), requiresReference, bankAccountId || null]);
  return rows[0];
}

async function updatePaymentMethod(companyId, methodId, { methodName, requiresReference, isActive, bankAccountId }) {
  const qb = new QueryBuilder([methodId, companyId]);
  const fields = [];
  if (methodName        !== undefined) fields.push(`method_name = $${qb.add(methodName.trim())}`);
  if (requiresReference !== undefined) fields.push(`requires_reference = $${qb.add(requiresReference)}`);
  if (isActive          !== undefined) fields.push(`is_active = $${qb.add(isActive)}`);
  if (bankAccountId     !== undefined) fields.push(`bank_account_id = $${qb.add(bankAccountId || null)}`);
  if (!fields.length) throw AppError.badRequest('Nothing to update');

  const { rows } = await query(`
    UPDATE payment_methods SET ${fields.join(', ')}
    WHERE payment_method_id = $1 AND company_id = $2
    RETURNING payment_method_id, method_name, is_active, requires_reference, bank_account_id
  `, qb.params);
  if (!rows.length) throw AppError.notFound('Payment method');
  return rows[0];
}

// ── Terminals ─────────────────────────────────────────────────────────────────

// Used by the POS cashier — auto-seeds a default till if none exist
async function listTerminals(companyId, branchId) {
  const { rows } = await query(
    `SELECT terminal_id, terminal_name, terminal_code, description, is_active
     FROM pos_terminals WHERE company_id = $1 AND branch_id = $2 AND is_active = TRUE
     ORDER BY terminal_name`,
    [companyId, branchId]
  );

  if (!rows.length) {
    const { rows: created } = await query(`
      INSERT INTO pos_terminals (company_id, branch_id, terminal_name, terminal_code)
      VALUES ($1, $2, 'Default Till', 'TILL-01')
      ON CONFLICT (branch_id, terminal_code) DO UPDATE SET terminal_name = EXCLUDED.terminal_name
      RETURNING terminal_id, terminal_name, terminal_code, description, is_active
    `, [companyId, branchId]);
    return created;
  }

  return rows;
}

// Used by Settings page — returns all terminals with branch info and status
async function listAllTerminals(companyId, { branchId, includeInactive = false } = {}) {
  const qb = new QueryBuilder([companyId]);
  const conditions = ['pt.company_id = $1'];

  if (branchId) conditions.push(`pt.branch_id = $${qb.add(branchId)}`);
  if (!includeInactive) conditions.push('pt.is_active = TRUE');

  const { rows } = await query(`
    SELECT
      pt.terminal_id, pt.terminal_name, pt.terminal_code, pt.description, pt.is_active,
      pt.branch_id, b.branch_name,
      (SELECT COUNT(*)::int FROM pos_sessions ps WHERE ps.terminal_id = pt.terminal_id) AS session_count,
      (SELECT ps2.status FROM pos_sessions ps2
       WHERE ps2.terminal_id = pt.terminal_id
       ORDER BY ps2.session_start DESC LIMIT 1) AS last_session_status
    FROM pos_terminals pt
    JOIN branches b ON b.branch_id = pt.branch_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY b.branch_name, pt.terminal_name
  `, qb.params);

  return rows.map((r) => ({
    ...r,
    session_count: parseInt(r.session_count),
  }));
}

async function createTerminal(companyId, { branchId, terminalName, terminalCode, description }) {
  if (!branchId)     throw AppError.badRequest('branchId is required');
  if (!terminalName) throw AppError.badRequest('terminalName is required');
  if (!terminalCode) throw AppError.badRequest('terminalCode is required');

  const code = terminalCode.trim().toUpperCase();
  const { rows: dup } = await query(
    'SELECT 1 FROM pos_terminals WHERE branch_id = $1 AND terminal_code = $2',
    [branchId, code]
  );
  if (dup.length) throw AppError.conflict('A terminal with that code already exists in this branch');

  const { rows } = await query(`
    INSERT INTO pos_terminals (company_id, branch_id, terminal_name, terminal_code, description, is_active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    RETURNING terminal_id, terminal_name, terminal_code, description, is_active, branch_id
  `, [companyId, branchId, terminalName.trim(), code, description || null]);

  return rows[0];
}

async function updateTerminal(companyId, terminalId, { terminalName, isActive, description }) {
  const qb = new QueryBuilder([terminalId, companyId]);
  const fields = [];
  if (terminalName !== undefined) fields.push(`terminal_name = $${qb.add(terminalName.trim())}`);
  if (isActive     !== undefined) fields.push(`is_active = $${qb.add(isActive)}`);
  if (description  !== undefined) fields.push(`description = $${qb.add(description)}`);
  if (!fields.length) throw AppError.badRequest('Nothing to update');

  const { rows } = await query(`
    UPDATE pos_terminals SET ${fields.join(', ')}
    WHERE terminal_id = $1 AND company_id = $2
    RETURNING terminal_id, terminal_name, terminal_code, description, is_active, branch_id
  `, qb.params);

  if (!rows.length) throw AppError.notFound('Terminal');
  return rows[0];
}

async function deleteTerminal(companyId, terminalId) {
  const { rows: openSessions } = await query(
    `SELECT 1 FROM pos_sessions WHERE terminal_id = $1 AND status = 'open' LIMIT 1`,
    [terminalId]
  );
  if (openSessions.length)
    throw AppError.badRequest('Cannot delete a terminal with an open session. Close the session first.');

  const { rows } = await query(`
    UPDATE pos_terminals
    SET is_active = FALSE, updated_at = now()
    WHERE terminal_id = $1 AND company_id = $2
    RETURNING terminal_id
  `, [terminalId, companyId]);

  if (!rows.length) throw AppError.notFound('Terminal');
}

// ── Sessions ──────────────────────────────────────────────────────────────────

async function getActiveSession(companyId, userId, branchId) {
  const params = [companyId, userId];
  let branchClause = '';
  if (branchId) { params.push(branchId); branchClause = `AND ps.branch_id = $3`; }

  const { rows } = await query(`
    SELECT ps.session_id, ps.terminal_id, ps.branch_id, ps.session_start,
           ps.opening_cash_amount::numeric, ps.status,
           pt.terminal_name, pt.terminal_code,
           b.branch_name,
           (SELECT COUNT(*)::int FROM sales_transactions st
            WHERE st.pos_session_id = ps.session_id AND st.status = 'completed') AS txn_count,
           (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM sales_transactions st
            WHERE st.pos_session_id = ps.session_id AND st.status = 'completed') AS session_sales
    FROM pos_sessions ps
    JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
    JOIN branches b ON b.branch_id = ps.branch_id
    WHERE ps.company_id = $1 AND ps.cashier_user_id = $2 AND ps.status = 'open'
    ${branchClause}
    LIMIT 1
  `, params);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    ...r,
    opening_cash_amount: parseFloat(r.opening_cash_amount),
    session_sales:       parseFloat(r.session_sales),
  };
}

async function openSession(companyId, branchId, userId, { terminalId, openingCashAmount = 0, openingNotes, payModeAmounts = [], forceClose = false }) {
  const { rows: termRows } = await query(
    `SELECT terminal_id, terminal_name, terminal_code FROM pos_terminals
     WHERE terminal_id = $1 AND branch_id = $2 AND company_id = $3 AND is_active = TRUE`,
    [terminalId, branchId, companyId]
  );
  if (!termRows.length) throw AppError.notFound('Terminal');

  const { rows: existing } = await query(`
    SELECT ps.session_id, ps.session_start,
           (u.first_name || ' ' || u.last_name) AS cashier_name
    FROM pos_sessions ps
    LEFT JOIN users u ON u.user_id = ps.cashier_user_id
    WHERE ps.terminal_id = $1 AND ps.status = 'open'
  `, [terminalId]);

  if (existing.length) {
    const stuck = existing[0];
    if (!forceClose) {
      throw AppError.conflict(
        'This terminal already has an open session. Close it first or take it over.',
        'SESSION_ALREADY_OPEN',
        { sessionId: stuck.session_id, sessionStart: stuck.session_start, cashierName: stuck.cashier_name }
      );
    }
    // Force-close the stuck session before opening a new one
    await query(`
      UPDATE pos_sessions
      SET status = 'closed', session_end = now(), closing_notes = 'Force-closed by new session open', updated_at = now()
      WHERE session_id = $1
    `, [stuck.session_id]);
  }

  const { rows } = await query(`
    INSERT INTO pos_sessions
      (company_id, branch_id, terminal_id, cashier_user_id, opening_cash_amount, opening_notes, opened_by_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $4)
    RETURNING session_id, session_start, opening_cash_amount::numeric, status
  `, [companyId, branchId, terminalId, userId, parseFloat(openingCashAmount) || 0, openingNotes || null]);

  const sessionId = rows[0].session_id;

  // Record per-pay-mode opening amounts
  if (payModeAmounts.length) {
    for (const pm of payModeAmounts) {
      if (pm.paymentMethodId && parseFloat(pm.amount) > 0) {
        await query(`
          INSERT INTO session_pay_mode_amounts (session_id, payment_method_id, count_type, amount)
          VALUES ($1, $2, 'opening', $3)
          ON CONFLICT (session_id, payment_method_id, count_type) DO UPDATE SET amount = EXCLUDED.amount
        `, [sessionId, pm.paymentMethodId, parseFloat(pm.amount)]);
      }
    }
  }

  return {
    ...rows[0],
    terminal_id:         terminalId,
    terminal_name:       termRows[0].terminal_name,
    terminal_code:       termRows[0].terminal_code,
    branch_id:           branchId,
    opening_cash_amount: parseFloat(rows[0].opening_cash_amount),
    txn_count:           0,
    session_sales:       0,
  };
}

async function getSessionSummary(companyId, sessionId) {
  const { rows: sessionRows } = await query(`
    SELECT ps.session_id, ps.session_start, ps.status,
           ps.opening_cash_amount::numeric,
           pt.terminal_name, pt.terminal_code, b.branch_name
    FROM pos_sessions ps
    JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
    JOIN branches b ON b.branch_id = ps.branch_id
    WHERE ps.session_id = $1 AND ps.company_id = $2
  `, [sessionId, companyId]);
  if (!sessionRows.length) throw AppError.notFound('Session');

  const [summaryRes, payRes] = await Promise.all([
    query(`
      SELECT COUNT(*)::int AS txn_count,
             COALESCE(SUM(total_amount),    0)::numeric AS total_sales,
             COALESCE(SUM(discount_amount), 0)::numeric AS total_discounts
      FROM sales_transactions
      WHERE pos_session_id = $1 AND status = 'completed'
    `, [sessionId]),
    query(`
      SELECT pm.payment_method_id, pm.method_name,
             COUNT(tp.payment_id)::int                    AS count,
             COALESCE(SUM(tp.amount_applied), 0)::numeric AS total
      FROM transaction_payments tp
      JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
      JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
      WHERE st.pos_session_id = $1 AND st.status = 'completed'
      GROUP BY pm.payment_method_id, pm.method_name ORDER BY total DESC
    `, [sessionId]),
  ]);

  const s = sessionRows[0];
  return {
    session_id:          s.session_id,
    session_start:       s.session_start,
    status:              s.status,
    terminal_name:       s.terminal_name,
    terminal_code:       s.terminal_code,
    branch_name:         s.branch_name,
    opening_cash_amount: parseFloat(s.opening_cash_amount),
    txn_count:           summaryRes.rows[0].txn_count,
    total_sales:         parseFloat(summaryRes.rows[0].total_sales),
    total_discounts:     parseFloat(summaryRes.rows[0].total_discounts),
    payment_breakdown:   payRes.rows.map((r) => ({
      payment_method_id: r.payment_method_id,
      method_name:       r.method_name,
      count:             r.count,
      total:             parseFloat(r.total),
    })),
  };
}

async function closeSession(companyId, sessionId, userId, { closingCashCounted = 0, closingNotes, closingPayModeAmounts = [] }) {
  const { rows: sessionRows } = await query(
    `SELECT ps.opening_cash_amount::numeric, pt.terminal_name
     FROM pos_sessions ps
     JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
     WHERE ps.session_id = $1 AND ps.company_id = $2 AND ps.status = 'open'`,
    [sessionId, companyId]
  );
  if (!sessionRows.length) throw AppError.notFound('Active session');

  const { rows: cashRows } = await query(`
    SELECT COALESCE(SUM(tp.amount_applied), 0)::numeric AS cash_received
    FROM transaction_payments tp
    JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
    JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
    WHERE st.pos_session_id = $1 AND pm.method_name = 'Cash' AND st.status = 'completed'
  `, [sessionId]);

  const openingFloat   = parseFloat(sessionRows[0].opening_cash_amount);
  const cashReceived   = parseFloat(cashRows[0]?.cash_received || 0);
  const expectedCash   = openingFloat + cashReceived;
  const closingCounted = parseFloat(closingCashCounted) || 0;
  const variance       = closingCounted - expectedCash;

  const { rows } = await query(`
    UPDATE pos_sessions
    SET status               = 'closed',
        session_end          = now(),
        closing_cash_counted = $3,
        closing_notes        = $4,
        expected_cash_amount = $5,
        cash_variance        = $6,
        closed_by_user_id    = $7,
        updated_at           = now()
    WHERE session_id = $1 AND company_id = $2
    RETURNING session_id, status, session_end,
              expected_cash_amount::numeric, cash_variance::numeric
  `, [sessionId, companyId, closingCounted, closingNotes || null, expectedCash, variance, userId]);

  // Record per-pay-mode closing amounts
  if (closingPayModeAmounts.length) {
    for (const pm of closingPayModeAmounts) {
      if (pm.paymentMethodId && parseFloat(pm.amount) >= 0) {
        await query(`
          INSERT INTO session_pay_mode_amounts (session_id, payment_method_id, count_type, amount)
          VALUES ($1, $2, 'closing', $3)
          ON CONFLICT (session_id, payment_method_id, count_type) DO UPDATE SET amount = EXCLUDED.amount
        `, [sessionId, pm.paymentMethodId, parseFloat(pm.amount)]);
      }
    }
  }

  return {
    ...rows[0],
    terminal_name:        sessionRows[0].terminal_name,
    expected_cash_amount: parseFloat(rows[0].expected_cash_amount),
    cash_variance:        parseFloat(rows[0].cash_variance),
  };
}

// ── Shifts Management ─────────────────────────────────────────────────────────

async function listSessions(companyId, { branchId, status, cashierId, startDate, endDate, page = 1, limit = 25 }) {
  const qb = new QueryBuilder([companyId]);
  const clauses = [];

  if (branchId)  clauses.push(`ps.branch_id = $${qb.add(branchId)}`);
  if (cashierId) clauses.push(`ps.cashier_user_id = $${qb.add(cashierId)}`);
  if (status)    clauses.push(`ps.status = $${qb.add(status)}`);
  if (startDate) clauses.push(`ps.session_start >= $${qb.add(startDate)}`);
  if (endDate)   clauses.push(`ps.session_start < ($${qb.add(endDate)}::date + interval '1 day')`);

  const where  = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
  const pg     = parseInt(page, 10);
  const lm     = parseInt(limit, 10);
  const offset = (pg - 1) * lm;

  // data query needs LIMIT/OFFSET; count query reuses the same WHERE params
  const dataQb = new QueryBuilder(qb.params);
  const limIdx = dataQb.add(lm);
  const offIdx = dataQb.add(offset);

  const [dataRes, countRes] = await Promise.all([
    query(`
      SELECT ps.session_id, ps.session_start, ps.session_end, ps.status,
             ps.opening_cash_amount::numeric,
             ps.closing_cash_counted::numeric,
             ps.expected_cash_amount::numeric,
             ps.cash_variance::numeric,
             ps.closing_notes,
             pt.terminal_name, pt.terminal_code,
             b.branch_name,
             u.first_name || ' ' || u.last_name AS cashier_name,
             (SELECT COUNT(*)::int FROM sales_transactions st
              WHERE st.pos_session_id = ps.session_id AND st.status = 'completed') AS txn_count,
             (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM sales_transactions st
              WHERE st.pos_session_id = ps.session_id AND st.status = 'completed') AS total_sales
      FROM pos_sessions ps
      JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
      JOIN branches b ON b.branch_id = ps.branch_id
      JOIN users u ON u.user_id = ps.cashier_user_id
      WHERE ps.company_id = $1 ${where}
      ORDER BY ps.session_start DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
    `, dataQb.params),
    query(`
      SELECT COUNT(*)::int AS total
      FROM pos_sessions ps WHERE ps.company_id = $1 ${where}
    `, qb.params),
  ]);

  return {
    sessions: dataRes.rows.map((r) => ({
      ...r,
      opening_cash_amount:  parseFloat(r.opening_cash_amount  ?? 0),
      closing_cash_counted: parseFloat(r.closing_cash_counted ?? 0),
      expected_cash_amount: parseFloat(r.expected_cash_amount ?? 0),
      cash_variance:        parseFloat(r.cash_variance        ?? 0),
      total_sales:          parseFloat(r.total_sales          ?? 0),
    })),
    total: countRes.rows[0].total,
    page:  parseInt(page),
    pages: Math.max(1, Math.ceil(countRes.rows[0].total / parseInt(limit))),
  };
}

async function getSessionDetail(companyId, sessionId) {
  const { rows: sessionRows } = await query(`
    SELECT ps.session_id, ps.session_start, ps.session_end, ps.status,
           ps.opening_cash_amount::numeric,
           ps.closing_cash_counted::numeric,
           ps.expected_cash_amount::numeric,
           ps.cash_variance::numeric,
           ps.opening_notes, ps.closing_notes,
           pt.terminal_name, pt.terminal_code,
           b.branch_name,
           u.first_name || ' ' || u.last_name AS cashier_name,
           cu.first_name || ' ' || cu.last_name AS closed_by_name
    FROM pos_sessions ps
    JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
    JOIN branches b ON b.branch_id = ps.branch_id
    JOIN users u ON u.user_id = ps.cashier_user_id
    LEFT JOIN users cu ON cu.user_id = ps.closed_by_user_id
    WHERE ps.session_id = $1 AND ps.company_id = $2
  `, [sessionId, companyId]);
  if (!sessionRows.length) throw AppError.notFound('Session');

  const [txnRes, payRes] = await Promise.all([
    query(`
      SELECT st.transaction_id, st.transaction_number, st.transaction_date,
             st.total_amount::numeric, st.status,
             COALESCE(c.customer_name, 'Walk-in') AS customer_name,
             (SELECT string_agg(pm.method_name, ', ')
              FROM transaction_payments tp2
              JOIN payment_methods pm ON pm.payment_method_id = tp2.payment_method_id
              WHERE tp2.transaction_id = st.transaction_id) AS payment_methods
      FROM sales_transactions st
      LEFT JOIN customers c ON c.customer_id = st.customer_id
      WHERE st.pos_session_id = $1
      ORDER BY st.transaction_date ASC
    `, [sessionId]),
    query(`
      SELECT pm.payment_method_id, pm.method_name,
             COUNT(tp.payment_id)::int                    AS count,
             COALESCE(SUM(tp.amount_applied), 0)::numeric AS total
      FROM transaction_payments tp
      JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
      JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
      WHERE st.pos_session_id = $1 AND st.status = 'completed'
      GROUP BY pm.payment_method_id, pm.method_name ORDER BY total DESC
    `, [sessionId]),
  ]);

  let payModeRows = [];
  try {
    const payModeRes = await query(`
      SELECT spa.count_type, spa.amount::numeric,
             pm.method_name
      FROM session_pay_mode_amounts spa
      JOIN payment_methods pm ON pm.payment_method_id = spa.payment_method_id
      WHERE spa.session_id = $1
      ORDER BY pm.method_name, spa.count_type
    `, [sessionId]);
    payModeRows = payModeRes.rows;
  } catch { /* table may not exist in older deployments */ }

  const s = sessionRows[0];
  return {
    session_id:           s.session_id,
    session_start:        s.session_start,
    session_end:          s.session_end,
    status:               s.status,
    terminal_name:        s.terminal_name,
    terminal_code:        s.terminal_code,
    branch_name:          s.branch_name,
    cashier_name:         s.cashier_name,
    closed_by_name:       s.closed_by_name,
    opening_notes:        s.opening_notes,
    closing_notes:        s.closing_notes,
    opening_cash_amount:  parseFloat(s.opening_cash_amount  ?? 0),
    closing_cash_counted: parseFloat(s.closing_cash_counted ?? 0),
    expected_cash_amount: parseFloat(s.expected_cash_amount ?? 0),
    cash_variance:        parseFloat(s.cash_variance        ?? 0),
    txn_count:            txnRes.rows.length,
    total_sales:          txnRes.rows.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0),
    transactions:         txnRes.rows.map((r) => ({
      ...r,
      total_amount: parseFloat(r.total_amount),
    })),
    payment_breakdown: payRes.rows.map((r) => ({
      payment_method_id: r.payment_method_id,
      method_name:       r.method_name,
      count:             r.count,
      total:             parseFloat(r.total),
    })),
    pay_mode_amounts: payModeRows.map((r) => ({
      method_name: r.method_name,
      count_type:  r.count_type,
      amount:      parseFloat(r.amount),
    })),
  };
}

async function forceCloseSession(companyId, sessionId, userId, body) {
  const { rows: sessionRows } = await query(
    `SELECT session_id FROM pos_sessions WHERE session_id = $1 AND company_id = $2 AND status = 'open'`,
    [sessionId, companyId]
  );
  if (!sessionRows.length) throw AppError.notFound('Open session');
  return closeSession(companyId, sessionId, userId, body);
}

module.exports = {
  listSellableProducts,
  listPaymentMethods, createPaymentMethod, updatePaymentMethod,
  listTerminals, listAllTerminals, createTerminal, updateTerminal, deleteTerminal,
  getActiveSession, openSession, getSessionSummary, closeSession,
  listSessions, getSessionDetail, forceCloseSession,
};
