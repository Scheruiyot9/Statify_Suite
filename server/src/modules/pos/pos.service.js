const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const productsService = require('../products/products.service');
const QueryBuilder = require('../../shared/qb');
const jrn = require('../journal/journal.service');

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
            pm.account_number,
            pm.bank_account_id, ba.account_name AS bank_account_name, ba.bank_name
     FROM payment_methods pm
     LEFT JOIN bank_accounts ba ON ba.bank_account_id = pm.bank_account_id
     WHERE pm.company_id = $1 ${includeInactive ? '' : 'AND pm.is_active = TRUE'}
     ORDER BY pm.method_name`,
    [companyId]
  );
  return rows;
}

async function createPaymentMethod(companyId, { methodName, requiresReference = false, bankAccountId, accountNumber }) {
  const { rows } = await query(`
    INSERT INTO payment_methods (company_id, method_name, requires_reference, bank_account_id, account_number)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING payment_method_id, method_name, is_active, requires_reference, bank_account_id, account_number
  `, [companyId, methodName.trim(), requiresReference, bankAccountId || null, accountNumber?.trim() || null]);
  return rows[0];
}

async function updatePaymentMethod(companyId, methodId, { methodName, requiresReference, isActive, bankAccountId, accountNumber }) {
  const qb = new QueryBuilder([methodId, companyId]);
  const fields = [];
  if (methodName        !== undefined) fields.push(`method_name = $${qb.add(methodName.trim())}`);
  if (requiresReference !== undefined) fields.push(`requires_reference = $${qb.add(requiresReference)}`);
  if (isActive          !== undefined) fields.push(`is_active = $${qb.add(isActive)}`);
  if (bankAccountId     !== undefined) fields.push(`bank_account_id = $${qb.add(bankAccountId || null)}`);
  if (accountNumber     !== undefined) fields.push(`account_number = $${qb.add(accountNumber?.trim() || null)}`);
  if (!fields.length) throw AppError.badRequest('Nothing to update');

  const { rows } = await query(`
    UPDATE payment_methods SET ${fields.join(', ')}
    WHERE payment_method_id = $1 AND company_id = $2
    RETURNING payment_method_id, method_name, is_active, requires_reference, bank_account_id, account_number
  `, qb.params);
  if (!rows.length) throw AppError.notFound('Payment method');
  return rows[0];
}

async function deletePaymentMethod(companyId, methodId) {
  // Guard: cannot delete if used in any transaction payment
  const { rows: used } = await query(
    `SELECT 1 FROM transaction_payments tp
     JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
     WHERE tp.payment_method_id = $1 AND st.company_id = $2 LIMIT 1`,
    [methodId, companyId]
  );
  if (used.length)
    throw AppError.badRequest('Cannot delete a payment method that has been used in transactions. Deactivate it instead.');

  const { rows } = await query(
    `DELETE FROM payment_methods WHERE payment_method_id = $1 AND company_id = $2 RETURNING payment_method_id`,
    [methodId, companyId]
  );
  if (!rows.length) throw AppError.notFound('Payment method');
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
  const { rows: [terminal] } = await query(
    `SELECT terminal_id FROM pos_terminals WHERE terminal_id = $1 AND company_id = $2`,
    [terminalId, companyId]
  );
  if (!terminal) throw AppError.notFound('Terminal');

  const { rows: openSessions } = await query(
    `SELECT 1 FROM pos_sessions WHERE terminal_id = $1 AND status = 'open' LIMIT 1`,
    [terminalId]
  );
  if (openSessions.length)
    throw AppError.badRequest('Cannot delete a terminal with an open session. Close the session first.');

  const { rows: anySessions } = await query(
    `SELECT 1 FROM pos_sessions WHERE terminal_id = $1 LIMIT 1`,
    [terminalId]
  );

  if (anySessions.length) {
    // Has session history — soft delete only
    await query(
      `UPDATE pos_terminals SET is_active = FALSE WHERE terminal_id = $1`,
      [terminalId]
    );
  } else {
    // No session history — hard delete
    await query(
      `DELETE FROM pos_terminals WHERE terminal_id = $1`,
      [terminalId]
    );
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────

const MANAGER_ROLES = ['super_admin', 'company_admin', 'branch_manager'];

async function getActiveSession(companyId, userId, branchId, role) {
  const isManager = MANAGER_ROLES.includes(role);
  // Managers see any open session on the branch; cashiers only see their own
  const params = isManager ? [companyId] : [companyId, userId];
  const userClause = isManager ? '' : 'AND ps.cashier_user_id = $2';
  let branchClause = '';
  if (branchId) {
    params.push(branchId);
    branchClause = `AND ps.branch_id = $${params.length}`;
  }

  const { rows } = await query(`
    SELECT ps.session_id, ps.terminal_id, ps.branch_id, ps.session_start,
           ps.opening_cash_amount::numeric, ps.status,
           ps.cashier_user_id,
           u.first_name || ' ' || u.last_name AS cashier_name,
           pt.terminal_name, pt.terminal_code,
           b.branch_name,
           (SELECT COUNT(*)::int FROM sales_transactions st
            WHERE st.pos_session_id = ps.session_id AND st.status = 'completed') AS txn_count,
           (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM sales_transactions st
            WHERE st.pos_session_id = ps.session_id AND st.status = 'completed') AS session_sales
    FROM pos_sessions ps
    JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
    JOIN branches b ON b.branch_id = ps.branch_id
    JOIN users u ON u.user_id = ps.cashier_user_id
    WHERE ps.company_id = $1 AND ps.status = 'open'
    ${userClause}
    ${branchClause}
    ORDER BY ps.session_start DESC
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

async function openSession(companyId, branchId, userId, { terminalId, openingCashAmount = 0, openingNotes, payModeAmounts = [], forceClose = false, takeoverCashCounted = 0, takeoverNotes = null }) {
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
    // Properly close the stuck session (calculates variance, records closer)
    await closeSession(companyId, stuck.session_id, userId, {
      closingCashCounted: takeoverCashCounted,
      closingNotes: takeoverNotes ?? 'Force-closed via terminal takeover',
    });
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

  const [summaryRes, payRes, cashOutRes] = await Promise.all([
    query(`
      SELECT COUNT(*)::int AS txn_count,
             COALESCE(SUM(total_amount),    0)::numeric AS total_sales,
             COALESCE(SUM(discount_amount), 0)::numeric AS total_discounts,
             COUNT(*) FILTER (WHERE is_credit_sale = TRUE)::int AS credit_sale_count,
             COALESCE(SUM(total_amount) FILTER (WHERE is_credit_sale = TRUE), 0)::numeric AS credit_sale_amount
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
    query(`
      SELECT co.cash_out_id, co.out_type, co.amount::numeric, co.notes,
             co.created_at, co.payment_method_id,
             pm.method_name AS payment_method_name,
             a.account_name, s.supplier_name,
             u.first_name || ' ' || u.last_name AS created_by_name
      FROM session_cash_outs co
      LEFT JOIN payment_methods pm ON pm.payment_method_id = co.payment_method_id
      LEFT JOIN accounts  a ON a.account_id  = co.account_id
      LEFT JOIN suppliers s ON s.supplier_id = co.supplier_id
      LEFT JOIN users     u ON u.user_id     = co.created_by_user_id
      WHERE co.session_id = $1
      ORDER BY co.created_at
    `, [sessionId]),
  ]);

  const s = sessionRows[0];
  const cashOuts      = cashOutRes.rows.map((r) => ({ ...r, amount: parseFloat(r.amount) }));
  const totalCashOuts = cashOuts.reduce((acc, r) => acc + r.amount, 0);
  // Build per-method cash-out map (null payment_method_id treated as Cash)
  const cashOutsByMethod = {};
  for (const co of cashOuts) {
    const key = co.payment_method_id || '__cash__';
    cashOutsByMethod[key] = (cashOutsByMethod[key] || 0) + co.amount;
  }

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
    credit_sale_count:   summaryRes.rows[0].credit_sale_count,
    credit_sale_amount:  parseFloat(summaryRes.rows[0].credit_sale_amount),
    total_cash_outs:     totalCashOuts,
    cash_outs:           cashOuts,
    cash_outs_by_method: cashOutsByMethod,
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

  const { rows: cashOutRows } = await query(`
    SELECT payment_method_id, COALESCE(SUM(amount), 0)::numeric AS total
    FROM session_cash_outs
    WHERE session_id = $1
    GROUP BY payment_method_id
  `, [sessionId]);

  // Cash-outs with no payment_method_id default to Cash
  const cashOutByMethod = {};
  let cashOutsNullTotal = 0;
  for (const r of cashOutRows) {
    if (r.payment_method_id) cashOutByMethod[r.payment_method_id] = parseFloat(r.total);
    else cashOutsNullTotal += parseFloat(r.total);
  }

  const openingFloat   = parseFloat(sessionRows[0].opening_cash_amount);
  const cashReceived   = parseFloat(cashRows[0]?.cash_received || 0);
  // Cash-specific outs: method-matched to Cash + any legacy null-method outs
  const cashMethodId   = (await query(
    `SELECT payment_method_id FROM payment_methods WHERE company_id = $1 AND method_name = 'Cash' LIMIT 1`,
    [companyId]
  )).rows[0]?.payment_method_id;
  const cashOuts       = cashOutsNullTotal + (cashMethodId ? (cashOutByMethod[cashMethodId] || 0) : 0);

  // Transfers in/out of Cash mode affect expected cash balance
  let transferToCash = 0, transferFromCash = 0;
  if (cashMethodId) {
    const { rows: xferRows } = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN to_method_id   = $2 THEN amount ELSE 0 END), 0)::numeric AS to_cash,
        COALESCE(SUM(CASE WHEN from_method_id = $2 THEN amount ELSE 0 END), 0)::numeric AS from_cash
      FROM session_transfers WHERE session_id = $1
    `, [sessionId, cashMethodId]);
    transferToCash   = parseFloat(xferRows[0]?.to_cash   || 0);
    transferFromCash = parseFloat(xferRows[0]?.from_cash || 0);
  }

  const expectedCash   = openingFloat + cashReceived - cashOuts + transferToCash - transferFromCash;
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

  const result = {
    ...rows[0],
    terminal_name:        sessionRows[0].terminal_name,
    expected_cash_amount: parseFloat(rows[0].expected_cash_amount),
    cash_variance:        parseFloat(rows[0].cash_variance),
  };

  // Always post a session summary at close — postSessionSummaryEntry's NOT_YET_POSTED
  // filter skips individually-posted transactions (per_transaction mode) and exits
  // early if the session was already summarised. This also mops up any transactions
  // that were made while posting mode was session_summary or daily_summary and then
  // the mode was switched to per_transaction before the session closed.
  // Note: daily_summary is intentionally NOT triggered here — it is admin-run manually
  // via POST /journal/daily-summaries so one JE covers the full day across all sessions.
  await jrn.postSessionSummaryEntry(companyId, sessionId, userId).catch((e) =>
    console.error('[ledger] session summary at close failed:', e.message)
  );

  return result;
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
           ps.corrected_at, ps.correction_reason,
           pt.terminal_name, pt.terminal_code,
           b.branch_name,
           u.first_name  || ' ' || u.last_name  AS cashier_name,
           cu.first_name || ' ' || cu.last_name AS closed_by_name,
           cr.first_name || ' ' || cr.last_name AS corrected_by_name
    FROM pos_sessions ps
    JOIN pos_terminals pt ON pt.terminal_id = ps.terminal_id
    JOIN branches b ON b.branch_id = ps.branch_id
    JOIN users u ON u.user_id = ps.cashier_user_id
    LEFT JOIN users cu ON cu.user_id = ps.closed_by_user_id
    LEFT JOIN users cr ON cr.user_id = ps.corrected_by
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
    corrected_at:         s.corrected_at    ?? null,
    corrected_by_name:    s.corrected_by_name ?? null,
    correction_reason:    s.correction_reason ?? null,
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

// ── Cash-outs (petty cash disbursements during a shift) ───────────────────────

async function recordCashOut(companyId, sessionId, userId, data, hasFinance) {
  const { out_type, amount, notes, account_id, supplier_id, payment_method_id } = data;

  const { rows: sessionRows } = await query(
    `SELECT ps.session_id, ps.branch_id
     FROM pos_sessions ps
     WHERE ps.session_id = $1 AND ps.company_id = $2 AND ps.status = 'open'`,
    [sessionId, companyId]
  );
  if (!sessionRows.length) throw AppError.notFound('Active session');
  const { branch_id } = sessionRows[0];

  const amt = parseFloat(amount);
  if (!amt || amt <= 0) throw AppError.badRequest('Amount must be positive');

  // Resolve the GL account for the payment method's CR side
  let resolvedPayMethodId = payment_method_id || null;
  let crAccountId = null;

  if (resolvedPayMethodId) {
    const { rows: pmRows } = await query(`
      SELECT pm.payment_method_id, pm.method_name, ba.account_id AS bank_gl_account_id
      FROM payment_methods pm
      LEFT JOIN bank_accounts ba ON ba.bank_account_id = pm.bank_account_id
      WHERE pm.payment_method_id = $1 AND pm.company_id = $2
    `, [resolvedPayMethodId, companyId]);
    if (pmRows.length) crAccountId = pmRows[0].bank_gl_account_id || null;
  }

  let journalEntryId = null;

  if (hasFinance && account_id) {
    journalEntryId = await transaction(async (client) => {
      // CR side: use payment method's linked GL account; fall back to Cash on Hand (1000)
      let crAccId = crAccountId;
      if (!crAccId) {
        const { rows } = await client.query(
          `SELECT account_id FROM accounts WHERE company_id = $1 AND account_code = '1000' AND is_active = TRUE`,
          [companyId]
        );
        if (!rows.length) throw AppError.unprocessable('Cash on Hand account (1000) not found in chart of accounts');
        crAccId = rows[0].account_id;
      }

      const jeSvc = require('../journal/journal.service');
      const typeLabels = { withdrawal: 'Cash Withdrawal', expense: 'Expense Payment', stock_payment: 'Stock Payment' };
      return jeSvc._post(client, companyId, {
        entryDate:   new Date().toISOString().slice(0, 10),
        description: `${typeLabels[out_type] || 'Cash Out'} — ${notes || 'POS shift'}`,
        sourceType:  'cash_out',
        sourceId:    sessionId,
        userId,
        lines: [
          { accountId: account_id, debit: amt, credit: 0, description: notes || null, entityType: supplier_id ? 'supplier' : null, entityId: supplier_id || null },
          { accountId: crAccId,    debit: 0, credit: amt, description: 'Payment mode reduction' },
        ],
      });
    });
  }

  const { rows } = await query(`
    INSERT INTO session_cash_outs
      (company_id, session_id, branch_id, out_type, amount, notes,
       account_id, supplier_id, payment_method_id, journal_entry_id, created_by_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `, [companyId, sessionId, branch_id, out_type, amt, notes || null,
      account_id || null, supplier_id || null, resolvedPayMethodId, journalEntryId, userId]);

  return rows[0];
}

async function listCashOuts(companyId, sessionId) {
  const { rows } = await query(`
    SELECT co.*, a.account_name, a.account_code, s.supplier_name,
           pm.method_name AS payment_method_name,
           u.first_name || ' ' || u.last_name AS created_by_name
    FROM session_cash_outs co
    LEFT JOIN accounts        a  ON a.account_id        = co.account_id
    LEFT JOIN suppliers       s  ON s.supplier_id       = co.supplier_id
    LEFT JOIN payment_methods pm ON pm.payment_method_id = co.payment_method_id
    LEFT JOIN users           u  ON u.user_id           = co.created_by_user_id
    WHERE co.session_id = $1 AND co.company_id = $2
    ORDER BY co.created_at
  `, [sessionId, companyId]);
  return rows;
}

async function listAllCashOuts(companyId, { startDate, endDate, branchId, page = 1, limit = 30 } = {}) {
  const params = [companyId];
  const where  = ['co.company_id = $1'];

  if (startDate) { params.push(startDate); where.push(`co.created_at >= $${params.length}::date`); }
  if (endDate)   { params.push(endDate);   where.push(`co.created_at <  ($${params.length}::date + INTERVAL '1 day')`); }
  if (branchId)  { params.push(branchId);  where.push(`co.branch_id = $${params.length}`); }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await query(`
    SELECT co.cash_out_id, co.out_type, co.amount::numeric, co.notes, co.created_at,
           co.journal_entry_id,
           a.account_name, a.account_code,
           s.supplier_name,
           pm.method_name  AS payment_method_name,
           pt.terminal_name,
           b.branch_name,
           u.first_name || ' ' || u.last_name AS created_by_name
    FROM session_cash_outs co
    LEFT JOIN accounts        a  ON a.account_id         = co.account_id
    LEFT JOIN suppliers       s  ON s.supplier_id        = co.supplier_id
    LEFT JOIN payment_methods pm ON pm.payment_method_id = co.payment_method_id
    LEFT JOIN pos_sessions    ps ON ps.session_id        = co.session_id
    LEFT JOIN pos_terminals   pt ON pt.terminal_id       = ps.terminal_id
    LEFT JOIN branches        b  ON b.branch_id          = co.branch_id
    LEFT JOIN users           u  ON u.user_id            = co.created_by_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY co.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM session_cash_outs co WHERE ${where.slice(0, where.length - 0).join(' AND ')}`,
    params.slice(0, params.length - 2)
  );

  return {
    cashOuts: rows.map((r) => ({ ...r, amount: parseFloat(r.amount) })),
    total:    countRows[0].total,
    pages:    Math.ceil(countRows[0].total / limit),
  };
}

// ── Hold Carts ────────────────────────────────────────────────────────────────

async function createHold(companyId, branchId, userId, { label, cartData }) {
  const { rows } = await query(
    `INSERT INTO pos_holds (company_id, branch_id, created_by, label, cart_data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING hold_id, label, created_at,
               (SELECT first_name || ' ' || last_name FROM users WHERE user_id = $3) AS created_by_name`,
    [companyId, branchId, userId, label || null, JSON.stringify(cartData)]
  );
  return rows[0];
}

async function listHolds(companyId, branchId) {
  const { rows } = await query(
    `SELECT h.hold_id, h.label, h.cart_data, h.created_at,
            u.first_name || ' ' || u.last_name AS created_by_name
       FROM pos_holds h
       JOIN users u ON u.user_id = h.created_by
      WHERE h.company_id = $1 AND h.branch_id = $2
      ORDER BY h.created_at DESC`,
    [companyId, branchId]
  );
  return rows;
}

async function deleteHold(companyId, holdId) {
  const { rowCount } = await query(
    `DELETE FROM pos_holds WHERE hold_id = $1 AND company_id = $2`,
    [holdId, companyId]
  );
  if (!rowCount) throw AppError.notFound('Hold');
}

// ── Pay Mode Transfers ────────────────────────────────────────────────────────

async function listAllTransfers(companyId, { startDate, endDate, branchId, page = 1, limit = 30 } = {}) {
  const params = [companyId];
  const where  = ['t.company_id = $1'];

  if (startDate) { params.push(startDate); where.push(`t.created_at >= $${params.length}::date`); }
  if (endDate)   { params.push(endDate);   where.push(`t.created_at <  ($${params.length}::date + INTERVAL '1 day')`); }
  if (branchId)  { params.push(branchId);  where.push(`t.branch_id = $${params.length}`); }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await query(`
    SELECT t.transfer_id, t.transfer_type, t.amount::numeric, t.notes, t.created_at,
           t.session_id,
           fm.method_name AS from_method_name,
           tm.method_name AS to_method_name,
           pt.terminal_name,
           b.branch_name,
           u.first_name || ' ' || u.last_name AS created_by_name
    FROM session_transfers t
    LEFT JOIN payment_methods fm ON fm.payment_method_id = t.from_method_id
    LEFT JOIN payment_methods tm ON tm.payment_method_id = t.to_method_id
    LEFT JOIN pos_sessions    ps ON ps.session_id        = t.session_id
    LEFT JOIN pos_terminals   pt ON pt.terminal_id       = ps.terminal_id
    LEFT JOIN branches        b  ON b.branch_id          = t.branch_id
    LEFT JOIN users           u  ON u.user_id            = t.created_by_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM session_transfers t WHERE ${where.slice(0, where.length).join(' AND ')}`,
    params.slice(0, params.length - 2)
  );

  return {
    transfers: rows.map((r) => ({ ...r, amount: parseFloat(r.amount) })),
    total:     countRows[0].total,
    pages:     Math.ceil(countRows[0].total / limit),
  };
}

async function createTransfer(companyId, sessionId, userId, { transferType, fromMethodId, toMethodId, amount, notes, referenceTxnId }) {
  const { rows: sessionRows } = await query(
    `SELECT session_id, branch_id FROM pos_sessions
     WHERE session_id = $1 AND company_id = $2 AND status = 'open'`,
    [sessionId, companyId]
  );
  if (!sessionRows.length) throw AppError.notFound('Active session');

  if (fromMethodId === toMethodId) throw AppError.badRequest('From and To payment modes must be different');

  const amt = parseFloat(amount);
  if (!amt || amt <= 0) throw AppError.badRequest('Amount must be positive');

  const allowed = ['sweep', 'float_topup', 'correction'];
  if (!allowed.includes(transferType)) throw AppError.badRequest('Invalid transfer type');

  const { branch_id } = sessionRows[0];

  const { rows } = await query(`
    INSERT INTO session_transfers
      (company_id, session_id, branch_id, transfer_type, from_method_id, to_method_id,
       amount, notes, reference_txn_id, created_by_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [companyId, sessionId, branch_id, transferType, fromMethodId, toMethodId,
      amt, notes || null, referenceTxnId || null, userId]);

  // Enrich the response with method names
  const { rows: methods } = await query(`
    SELECT payment_method_id, method_name FROM payment_methods
    WHERE payment_method_id IN ($1,$2)
  `, [fromMethodId, toMethodId]);
  const methodMap = Object.fromEntries(methods.map((m) => [m.payment_method_id, m.method_name]));

  return {
    ...rows[0],
    from_method_name: methodMap[fromMethodId] || null,
    to_method_name:   methodMap[toMethodId]   || null,
  };
}

async function listTransfers(companyId, sessionId) {
  const { rows } = await query(`
    SELECT t.*,
           fm.method_name AS from_method_name,
           tm.method_name AS to_method_name,
           u.first_name || ' ' || u.last_name AS created_by_name
    FROM session_transfers t
    LEFT JOIN payment_methods fm ON fm.payment_method_id = t.from_method_id
    LEFT JOIN payment_methods tm ON tm.payment_method_id = t.to_method_id
    LEFT JOIN users           u  ON u.user_id            = t.created_by_user_id
    WHERE t.session_id = $1 AND t.company_id = $2
    ORDER BY t.created_at
  `, [sessionId, companyId]);
  return rows;
}

// ── Shift Correction (company_admin only) ─────────────────────────────────────

async function correctSession(companyId, sessionId, userId, { openingCashAmount, closingCashCounted, correctionReason, workDate }) {
  if (!correctionReason?.trim()) throw AppError.badRequest('Correction reason is required');

  const { rows: [sess] } = await query(
    `SELECT session_id, status,
            opening_cash_amount::numeric,
            closing_cash_counted::numeric,
            expected_cash_amount::numeric
     FROM pos_sessions WHERE session_id = $1 AND company_id = $2`,
    [sessionId, companyId]
  );
  if (!sess) throw AppError.notFound('Session');

  const hasOpening = openingCashAmount !== undefined && openingCashAmount !== null && openingCashAmount !== '';
  const hasClosing = closingCashCounted !== undefined && closingCashCounted !== null && closingCashCounted !== '';
  const hasWorkDate = !!workDate;

  if (!hasOpening && !hasClosing && !hasWorkDate) throw AppError.badRequest('Provide at least one value to correct');
  if (hasClosing && sess.status === 'open')
    throw AppError.badRequest('Closing balance can only be corrected on a closed shift');

  const newOpening = hasOpening ? parseFloat(openingCashAmount) : null;
  const newClosing = hasClosing ? parseFloat(closingCashCounted) : null;

  const qb = new QueryBuilder([sessionId, companyId]);
  const sets = [];

  if (hasOpening) {
    sets.push(`opening_cash_amount = $${qb.add(newOpening)}`);
    // Only recalculate expected/variance on closed sessions
    // (open sessions recalculate at close time)
    if (sess.status !== 'open') {
      const oldOpening  = parseFloat(sess.opening_cash_amount  || 0);
      const oldExpected = parseFloat(sess.expected_cash_amount || 0);
      const newExpected = +(oldExpected - oldOpening + newOpening).toFixed(2);
      const effectiveClosing = newClosing !== null
        ? newClosing
        : parseFloat(sess.closing_cash_counted || 0);
      sets.push(`expected_cash_amount = $${qb.add(newExpected)}`);
      sets.push(`cash_variance = $${qb.add(+(effectiveClosing - newExpected).toFixed(2))}`);
    }
  }

  if (hasClosing) {
    sets.push(`closing_cash_counted = $${qb.add(newClosing)}`);
    if (!hasOpening) {
      // Opening unchanged → expected unchanged → just re-derive variance
      const expected = parseFloat(sess.expected_cash_amount || 0);
      sets.push(`cash_variance = $${qb.add(+(newClosing - expected).toFixed(2))}`);
    }
  }

  if (hasWorkDate) {
    // Replace date part of session_start, preserving the original time-of-day
    sets.push(`session_start = ($${qb.add(workDate)}::date + session_start::time)`);
  }

  sets.push(`corrected_by     = $${qb.add(userId)}`);
  sets.push(`corrected_at     = now()`);
  sets.push(`correction_reason = $${qb.add(correctionReason.trim())}`);
  sets.push(`updated_at       = now()`);

  const { rows } = await query(`
    UPDATE pos_sessions SET ${sets.join(', ')}
    WHERE session_id = $1 AND company_id = $2
    RETURNING session_id,
              opening_cash_amount::numeric,
              closing_cash_counted::numeric,
              expected_cash_amount::numeric,
              cash_variance::numeric,
              corrected_by, corrected_at, correction_reason
  `, qb.params);

  const r = rows[0];
  return {
    ...r,
    opening_cash_amount:  parseFloat(r.opening_cash_amount  ?? 0),
    closing_cash_counted: parseFloat(r.closing_cash_counted ?? 0),
    expected_cash_amount: parseFloat(r.expected_cash_amount ?? 0),
    cash_variance:        parseFloat(r.cash_variance        ?? 0),
  };
}

module.exports = {
  listSellableProducts,
  listPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  listTerminals, listAllTerminals, createTerminal, updateTerminal, deleteTerminal,
  getActiveSession, openSession, getSessionSummary, closeSession,
  listSessions, getSessionDetail, forceCloseSession,
  correctSession,
  recordCashOut, listCashOuts, listAllCashOuts, listAllTransfers,
  createTransfer, listTransfers,
  createHold, listHolds, deleteHold,
};
