'use strict';

const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(val) {
  if (!val) return new Date().toISOString().slice(0, 10);
  if (typeof val === 'string') return val.slice(0, 10);
  return new Date(val).toISOString().slice(0, 10);
}

// Returns { account_code: account_id } for all requested codes that exist
async function findAccIds(client, companyId, codes) {
  const { rows } = await client.query(
    `SELECT account_code, account_id FROM accounts
     WHERE company_id = $1 AND account_code = ANY($2) AND is_active = TRUE`,
    [companyId, codes]
  );
  return Object.fromEntries(rows.map((r) => [r.account_code, r.account_id]));
}

// ── Core posting engine ───────────────────────────────────────────────────────
// lines: [{ accountId, debit, credit, description?, entityType?, entityId? }]
async function _post(client, companyId, { entryDate, description, sourceType, sourceId, userId, lines }) {
  const totalDr = lines.reduce((s, l) => s + (l.debit  || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(totalDr - totalCr) > 0.005) {
    throw new Error(`Unbalanced entry: DR=${totalDr.toFixed(4)} CR=${totalCr.toFixed(4)}`);
  }

  const { rows: [{ je_counter }] } = await client.query(
    `UPDATE companies SET je_counter = je_counter + 1 WHERE company_id = $1 RETURNING je_counter`,
    [companyId]
  );
  const entryNumber = `JE-${new Date().getFullYear()}-${String(je_counter).padStart(6, '0')}`;

  const { rows: [je] } = await client.query(`
    INSERT INTO journal_entries
      (company_id, entry_number, entry_date, description, source_type, source_id, created_by_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING journal_entry_id
  `, [companyId, entryNumber, entryDate, description || null, sourceType, sourceId || null, userId || null]);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(`
      INSERT INTO ledger_entry_lines
        (journal_entry_id, account_id, description, debit, credit, line_order, entity_type, entity_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      je.journal_entry_id,
      l.accountId,
      l.description   || null,
      +(l.debit  || 0).toFixed(4),
      +(l.credit || 0).toFixed(4),
      i,
      l.entityType    || null,
      l.entityId      || null,
    ]);
  }

  return je.journal_entry_id;
}

// ── Sale Entry ────────────────────────────────────────────────────────────────
// DR Cash/Bank (per payment method) + DR COGS + DR AR (unpaid portion)
// CR Revenue (net of VAT) + CR VAT Payable + CR Inventory
async function postSaleEntry(client, companyId, txn, items, rawPayments, cogsMap = null) {
  try {
    const accIds = await findAccIds(client, companyId, ['1000', '1010', '1100', '1200', '2100', '4000', '5000']);
    if (!accIds['4000']) return; // CoA not seeded

    let costMap = {};
    if (!cogsMap) {
      const productIds = [...new Set(items.map((i) => i.productId || i.product_id))];
      const { rows: prods } = await client.query(
        `SELECT product_id, COALESCE(cost_price, 0)::numeric AS cost_price FROM products WHERE product_id = ANY($1)`,
        [productIds]
      );
      costMap = Object.fromEntries(prods.map((p) => [p.product_id, parseFloat(p.cost_price)]));
    }

    const pmIds = [...new Set(rawPayments.map((p) => p.paymentMethodId || p.payment_method_id))].filter(Boolean);
    // pmMap: paymentMethodId → { methodName, glAccountId (from linked bank account's GL account) }
    let pmMap = {};
    if (pmIds.length) {
      const { rows: pms } = await client.query(
        `SELECT pm.payment_method_id, pm.method_name, ba.account_id AS gl_account_id
         FROM payment_methods pm
         LEFT JOIN bank_accounts ba ON ba.bank_account_id = pm.bank_account_id
         WHERE pm.payment_method_id = ANY($1)`,
        [pmIds]
      );
      pmMap = Object.fromEntries(pms.map((pm) => [pm.payment_method_id, {
        methodName:  pm.method_name,
        glAccountId: pm.gl_account_id,
      }]));
    }

    const customerId   = txn.customer_id || txn.customerId || null;
    const totalAmount  = parseFloat(txn.total_amount || txn.totalAmount || 0);
    const taxAmount    = parseFloat(txn.tax_amount   || txn.taxAmount   || 0);
    const netRevenue   = +(totalAmount - taxAmount).toFixed(4);
    const entryDate    = toDateStr(txn.transaction_date || txn.transactionDate);
    const totalPaid    = rawPayments.reduce((s, p) => s + parseFloat(p.amountApplied || p.amount_applied || 0), 0);
    const arAmount     = +(totalAmount - totalPaid).toFixed(4);
    const totalCOGS = cogsMap
      ? Object.values(cogsMap).reduce((s, c) => s + c, 0)
      : items.reduce((s, i) => {
          const pid = i.productId || i.product_id;
          return s + parseFloat(i.quantity) * (costMap[pid] || 0);
        }, 0);

    const lines = [];

    // DR: cash/bank receipts per payment method
    // Priority: 1) payment method's linked bank account GL  2) name heuristic  3) Cash in Hand (1000)
    for (const pmt of rawPayments) {
      const pmId      = pmt.paymentMethodId || pmt.payment_method_id;
      const pm        = pmMap[pmId] || {};
      let drAccId     = pm.glAccountId || null;
      if (!drAccId) {
        const methodName = (pm.methodName || '').toLowerCase();
        const isBank     = methodName.includes('bank') || methodName.includes('transfer') || methodName.includes('cheque');
        drAccId = isBank && accIds['1010'] ? accIds['1010'] : accIds['1000'];
      }
      if (!drAccId) continue;
      const amt = parseFloat(pmt.amountApplied || pmt.amount_applied || 0);
      if (amt > 0.005) lines.push({ accountId: drAccId, debit: +amt.toFixed(4), credit: 0 });
    }

    // DR: AR for unpaid portion — linked to customer
    if (arAmount > 0.005 && accIds['1100']) {
      lines.push({
        accountId:  accIds['1100'],
        debit:      arAmount,
        credit:     0,
        entityType: customerId ? 'customer' : null,
        entityId:   customerId,
        description: customerId ? null : 'Walk-in AR',
      });
    }

    // DR: COGS
    if (totalCOGS > 0.005 && accIds['5000']) {
      lines.push({ accountId: accIds['5000'], debit: +totalCOGS.toFixed(4), credit: 0 });
    }

    // CR: Revenue (net of VAT)
    if (netRevenue > 0.005 && accIds['4000']) {
      lines.push({ accountId: accIds['4000'], debit: 0, credit: netRevenue });
    }

    // CR: VAT Payable
    if (taxAmount > 0.005 && accIds['2100']) {
      lines.push({ accountId: accIds['2100'], debit: 0, credit: +taxAmount.toFixed(4) });
    }

    // CR: Inventory (COGS amount)
    if (totalCOGS > 0.005 && accIds['1200']) {
      lines.push({ accountId: accIds['1200'], debit: 0, credit: +totalCOGS.toFixed(4) });
    }

    if (lines.length < 2) return;

    await _post(client, companyId, {
      entryDate,
      description: `Sale ${txn.transaction_number || txn.transactionNumber}`,
      sourceType:  'SALE',
      sourceId:    txn.transaction_id || txn.transactionId,
      userId:      txn.cashier_user_id || txn.cashierUserId || null,
      lines,
    });
  } catch (err) {
    console.error('[ledger] postSaleEntry skipped:', err.message);
  }
}

// ── Summary-mode helpers ──────────────────────────────────────────────────────

// Check whether a transaction has been included in a posted session or daily summary.
async function _isCoveredBySummary(client, companyId, transactionId) {
  const { rows: [st] } = await client.query(`
    SELECT pos_session_id, branch_id, transaction_date::date AS sale_date
    FROM sales_transactions WHERE transaction_id = $1 AND company_id = $2
  `, [transactionId, companyId]);
  if (!st) return false;

  if (st.pos_session_id) {
    const { rows } = await client.query(`
      SELECT 1 FROM journal_entries
      WHERE company_id=$1 AND source_type='SESSION_SALE_SUMMARY' AND source_id=$2 AND status='posted'
    `, [companyId, st.pos_session_id]);
    if (rows.length) return true;
  }

  const { rows } = await client.query(`
    SELECT 1 FROM journal_entries
    WHERE company_id=$1 AND source_type='DAILY_SALE_SUMMARY' AND source_id=$2 AND entry_date=$3 AND status='posted'
  `, [companyId, st.branch_id, st.sale_date]);
  return rows.length > 0;
}

// Build reversal lines for a single transaction (used when reversing a summary-covered sale).
// Returns { lines, txnNumber } or null.
async function _buildSaleReversalLines(client, companyId, transactionId, accIds) {
  const { rows: [st] } = await client.query(`
    SELECT total_amount::numeric, tax_amount::numeric, transaction_number
    FROM sales_transactions WHERE transaction_id = $1 AND company_id = $2
  `, [transactionId, companyId]);
  if (!st) return null;

  const { rows: pmtRows } = await client.query(`
    SELECT pm.method_name, ba.account_id AS gl_account_id, tp.amount_applied::numeric AS amt
    FROM transaction_payments tp
    JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
    LEFT JOIN bank_accounts ba ON ba.bank_account_id = pm.bank_account_id
    WHERE tp.transaction_id = $1
  `, [transactionId]);

  const { rows: [cogsRow] } = await client.query(`
    SELECT COALESCE(SUM(sti.quantity * COALESCE(p.cost_price, 0)), 0)::numeric AS cogs
    FROM sales_transaction_items sti
    JOIN products p ON p.product_id = sti.product_id
    WHERE sti.transaction_id = $1
  `, [transactionId]);

  const totalAmount = parseFloat(st.total_amount);
  const taxAmount   = parseFloat(st.tax_amount);
  const netRevenue  = +(totalAmount - taxAmount).toFixed(4);
  const totalCOGS   = parseFloat(cogsRow?.cogs || 0);

  const lines = [];

  // CR: cash/bank lines reversed
  for (const pmt of pmtRows) {
    let accId = pmt.gl_account_id || null;
    if (!accId) {
      const methodName = (pmt.method_name || '').toLowerCase();
      const isBank = methodName.includes('bank') || methodName.includes('transfer') || methodName.includes('cheque');
      accId = isBank && accIds['1010'] ? accIds['1010'] : accIds['1000'];
    }
    if (!accId) continue;
    const amt = parseFloat(pmt.amt);
    if (amt > 0.005) lines.push({ accountId: accId, debit: 0, credit: +amt.toFixed(4) });
  }

  if (totalCOGS > 0.005 && accIds['5000']) {
    lines.push({ accountId: accIds['5000'], debit: 0, credit: +totalCOGS.toFixed(4) });
  }
  if (netRevenue > 0.005 && accIds['4000']) {
    lines.push({ accountId: accIds['4000'], debit: netRevenue, credit: 0 });
  }
  if (taxAmount > 0.005 && accIds['2100']) {
    lines.push({ accountId: accIds['2100'], debit: +taxAmount.toFixed(4), credit: 0 });
  }
  if (totalCOGS > 0.005 && accIds['1200']) {
    lines.push({ accountId: accIds['1200'], debit: +totalCOGS.toFixed(4), credit: 0 });
  }

  return { lines, txnNumber: st.transaction_number };
}

// ── Session Sale Summary ──────────────────────────────────────────────────────
// One JE per session close — aggregates all completed sales in the session.
async function postSessionSummaryEntry(companyId, sessionId, userId) {
  return transaction(async (client) => {
    try {
      const { rows: existing } = await client.query(`
        SELECT 1 FROM journal_entries
        WHERE company_id=$1 AND source_type='SESSION_SALE_SUMMARY' AND source_id=$2 AND status='posted'
      `, [companyId, sessionId]);
      if (existing.length) return;

      // Exclude transactions already posted individually (mode was per_transaction earlier today)
      const NOT_YET_POSTED = `
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.company_id = $2 AND je.source_type = 'SALE'
            AND je.source_id = st.transaction_id AND je.status = 'posted'
        )`;

      const { rows: [agg] } = await client.query(`
        SELECT
          st.branch_id,
          MIN(st.transaction_date::date) AS entry_date,
          COALESCE(SUM(st.total_amount),  0)::numeric AS total_amount,
          COALESCE(SUM(st.tax_amount),    0)::numeric AS tax_amount
        FROM sales_transactions st
        WHERE st.pos_session_id = $1 AND st.company_id = $2 AND st.status = 'completed'
          ${NOT_YET_POSTED}
        GROUP BY st.branch_id
      `, [sessionId, companyId]);
      if (!agg || parseFloat(agg.total_amount) <= 0.005) return; // nothing unposted in this session

      const { rows: pmtRows } = await client.query(`
        SELECT pm.method_name, ba.account_id AS gl_account_id,
               COALESCE(SUM(tp.amount_applied), 0)::numeric AS total
        FROM transaction_payments tp
        JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
        LEFT JOIN bank_accounts ba ON ba.bank_account_id = pm.bank_account_id
        JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
        WHERE st.pos_session_id = $1 AND st.company_id = $2 AND st.status = 'completed'
          ${NOT_YET_POSTED}
        GROUP BY pm.method_name, ba.account_id
      `, [sessionId, companyId]);

      const { rows: [cogsRow] } = await client.query(`
        SELECT COALESCE(SUM(sti.quantity * COALESCE(p.cost_price, 0)), 0)::numeric AS total_cogs
        FROM sales_transaction_items sti
        JOIN products p ON p.product_id = sti.product_id
        JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
        WHERE st.pos_session_id = $1 AND st.company_id = $2 AND st.status = 'completed'
          ${NOT_YET_POSTED}
      `, [sessionId, companyId]);

      const accIds = await findAccIds(client, companyId, ['1000', '1010', '1200', '2100', '4000', '5000']);
      if (!accIds['4000']) return;

      const totalAmount = parseFloat(agg.total_amount);
      const taxAmount   = parseFloat(agg.tax_amount);
      const netRevenue  = +(totalAmount - taxAmount).toFixed(4);
      const totalCOGS   = parseFloat(cogsRow?.total_cogs || 0);

      const lines = [];

      for (const pmt of pmtRows) {
        let drAccId = pmt.gl_account_id || null;
        if (!drAccId) {
          const name = (pmt.method_name || '').toLowerCase();
          const isBank = name.includes('bank') || name.includes('transfer') || name.includes('cheque');
          drAccId = isBank && accIds['1010'] ? accIds['1010'] : accIds['1000'];
        }
        if (!drAccId) continue;
        const amt = parseFloat(pmt.total);
        if (amt > 0.005) lines.push({ accountId: drAccId, debit: +amt.toFixed(4), credit: 0 });
      }

      if (totalCOGS  > 0.005 && accIds['5000']) lines.push({ accountId: accIds['5000'], debit: +totalCOGS.toFixed(4),  credit: 0 });
      if (netRevenue > 0.005 && accIds['4000']) lines.push({ accountId: accIds['4000'], debit: 0, credit: netRevenue });
      if (taxAmount  > 0.005 && accIds['2100']) lines.push({ accountId: accIds['2100'], debit: 0, credit: +taxAmount.toFixed(4) });
      if (totalCOGS  > 0.005 && accIds['1200']) lines.push({ accountId: accIds['1200'], debit: 0, credit: +totalCOGS.toFixed(4) });

      if (lines.length < 2) return;

      await _post(client, companyId, {
        entryDate:   agg.entry_date,
        description: 'Session sales summary',
        sourceType:  'SESSION_SALE_SUMMARY',
        sourceId:    sessionId,
        userId,
        lines,
      });
    } catch (err) {
      console.error('[ledger] postSessionSummaryEntry skipped:', err.message);
    }
  });
}

// ── Daily Sale Summary ────────────────────────────────────────────────────────
// One JE per branch per day — admin-triggered via endpoint.
async function postDailySummaryEntry(companyId, branchId, date, userId) {
  return transaction(async (client) => {
    const { rows: existing } = await client.query(`
      SELECT 1 FROM journal_entries
      WHERE company_id=$1 AND source_type='DAILY_SALE_SUMMARY' AND source_id=$2 AND entry_date=$3 AND status='posted'
    `, [companyId, branchId, date]);
    if (existing.length) throw new Error(`Daily summary for ${date} already posted for this branch`);

    // Exclude transactions already covered by a session summary OR posted individually
    const UNPOSTED = `
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.company_id = $1 AND je.status = 'posted'
          AND (
            (je.source_type = 'SESSION_SALE_SUMMARY' AND je.source_id = st.pos_session_id)
            OR
            (je.source_type = 'SALE' AND je.source_id = st.transaction_id)
          )
      )`;

    const { rows: [agg] } = await client.query(`
      SELECT
        COALESCE(SUM(st.total_amount), 0)::numeric AS total_amount,
        COALESCE(SUM(st.tax_amount),   0)::numeric AS tax_amount
      FROM sales_transactions st
      WHERE st.company_id = $1 AND st.branch_id = $2
        AND st.transaction_date::date = $3 AND st.status = 'completed'
        ${UNPOSTED}
    `, [companyId, branchId, date]);
    if (!agg || parseFloat(agg.total_amount) <= 0.005) throw new Error('No unposted sales found for this date/branch');

    const { rows: pmtRows } = await client.query(`
      SELECT pm.method_name, ba.account_id AS gl_account_id,
             COALESCE(SUM(tp.amount_applied), 0)::numeric AS total
      FROM transaction_payments tp
      JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
      LEFT JOIN bank_accounts ba ON ba.bank_account_id = pm.bank_account_id
      JOIN sales_transactions st ON st.transaction_id = tp.transaction_id
      WHERE st.company_id = $1 AND st.branch_id = $2
        AND st.transaction_date::date = $3 AND st.status = 'completed'
        ${UNPOSTED}
      GROUP BY pm.method_name, ba.account_id
    `, [companyId, branchId, date]);

    const { rows: [cogsRow] } = await client.query(`
      SELECT COALESCE(SUM(sti.quantity * COALESCE(p.cost_price, 0)), 0)::numeric AS total_cogs
      FROM sales_transaction_items sti
      JOIN products p ON p.product_id = sti.product_id
      JOIN sales_transactions st ON st.transaction_id = sti.transaction_id
      WHERE st.company_id = $1 AND st.branch_id = $2
        AND st.transaction_date::date = $3 AND st.status = 'completed'
        ${UNPOSTED}
    `, [companyId, branchId, date]);

    const accIds = await findAccIds(client, companyId, ['1000', '1010', '1200', '2100', '4000', '5000']);
    if (!accIds['4000']) throw new Error('Chart of Accounts not seeded');

    const totalAmount = parseFloat(agg.total_amount);
    const taxAmount   = parseFloat(agg.tax_amount);
    const netRevenue  = +(totalAmount - taxAmount).toFixed(4);
    const totalCOGS   = parseFloat(cogsRow?.total_cogs || 0);

    const lines = [];

    for (const pmt of pmtRows) {
      let drAccId = pmt.gl_account_id || null;
      if (!drAccId) {
        const name = (pmt.method_name || '').toLowerCase();
        const isBank = name.includes('bank') || name.includes('transfer') || name.includes('cheque');
        drAccId = isBank && accIds['1010'] ? accIds['1010'] : accIds['1000'];
      }
      if (!drAccId) continue;
      const amt = parseFloat(pmt.total);
      if (amt > 0.005) lines.push({ accountId: drAccId, debit: +amt.toFixed(4), credit: 0 });
    }

    if (totalCOGS  > 0.005 && accIds['5000']) lines.push({ accountId: accIds['5000'], debit: +totalCOGS.toFixed(4),  credit: 0 });
    if (netRevenue > 0.005 && accIds['4000']) lines.push({ accountId: accIds['4000'], debit: 0, credit: netRevenue });
    if (taxAmount  > 0.005 && accIds['2100']) lines.push({ accountId: accIds['2100'], debit: 0, credit: +taxAmount.toFixed(4) });
    if (totalCOGS  > 0.005 && accIds['1200']) lines.push({ accountId: accIds['1200'], debit: 0, credit: +totalCOGS.toFixed(4) });

    if (lines.length < 2) throw new Error('Nothing to post');

    return _post(client, companyId, {
      entryDate:   date,
      description: `Daily sales summary — ${date}`,
      sourceType:  'DAILY_SALE_SUMMARY',
      sourceId:    branchId,
      userId,
      lines,
    });
  });
}

// ── Sale Void Entry ───────────────────────────────────────────────────────────
// Reversal of the original SALE journal entry — mirrors postVoidPaymentEntry pattern.
// Looks up the posted SALE entry by source_id and swaps all Dr/Cr sides.
async function postSaleVoidEntry(client, companyId, txn) {
  try {
    // Case 1: individual SALE JE exists — reverse it directly (per_transaction mode)
    const { rows: jeRows } = await client.query(
      `SELECT journal_entry_id FROM journal_entries
       WHERE company_id = $1 AND source_type = 'SALE' AND source_id = $2 AND status = 'posted'
       ORDER BY created_at DESC LIMIT 1`,
      [companyId, txn.transaction_id]
    );
    if (jeRows.length) {
      const { rows: origLines } = await client.query(
        `SELECT account_id, debit, credit, description, entity_type, entity_id
         FROM ledger_entry_lines WHERE journal_entry_id = $1`,
        [jeRows[0].journal_entry_id]
      );
      if (!origLines.length) return;
      await _post(client, companyId, {
        entryDate:   new Date().toISOString().slice(0, 10),
        description: `Void sale — ${txn.transaction_number}`,
        sourceType:  'SALE_VOID',
        sourceId:    txn.transaction_id,
        userId:      txn.voided_by_user_id || null,
        lines: origLines.map((l) => ({
          accountId: l.account_id, debit: parseFloat(l.credit), credit: parseFloat(l.debit),
          description: l.description, entityType: l.entity_type, entityId: l.entity_id,
        })),
      });
      return;
    }

    // Case 2: no individual JE — check if a summary JE covers this transaction
    const covered = await _isCoveredBySummary(client, companyId, txn.transaction_id);
    if (!covered) return;

    const accIds = await findAccIds(client, companyId, ['1000', '1010', '1200', '2100', '4000', '5000']);
    if (!accIds['4000']) return;

    const result = await _buildSaleReversalLines(client, companyId, txn.transaction_id, accIds);
    if (!result || result.lines.length < 2) return;

    await _post(client, companyId, {
      entryDate:   new Date().toISOString().slice(0, 10),
      description: `Void sale — ${result.txnNumber}`,
      sourceType:  'SALE_VOID',
      sourceId:    txn.transaction_id,
      userId:      txn.voided_by_user_id || null,
      lines:       result.lines,
    });
  } catch (err) {
    console.error('[ledger] postSaleVoidEntry skipped:', err.message);
  }
}

// ── Sale Edit Reversal ────────────────────────────────────────────────────────
// Same pattern as postSaleVoidEntry but used when a sale is being corrected
// (not fully voided). Always targets the LATEST posted SALE entry so repeated
// edits each reverse the previous corrected entry, not the original.
async function postSaleEditReversal(client, companyId, txn) {
  try {
    // Case 1: individual SALE JE exists — reverse it
    const { rows: jeRows } = await client.query(
      `SELECT journal_entry_id FROM journal_entries
       WHERE company_id = $1 AND source_type = 'SALE' AND source_id = $2 AND status = 'posted'
       ORDER BY created_at DESC LIMIT 1`,
      [companyId, txn.transaction_id]
    );
    if (jeRows.length) {
      const { rows: origLines } = await client.query(
        `SELECT account_id, debit, credit, description, entity_type, entity_id
         FROM ledger_entry_lines WHERE journal_entry_id = $1`,
        [jeRows[0].journal_entry_id]
      );
      if (!origLines.length) return;
      await _post(client, companyId, {
        entryDate:   new Date().toISOString().slice(0, 10),
        description: `Edit reversal — ${txn.transaction_number}`,
        sourceType:  'SALE_EDIT',
        sourceId:    txn.transaction_id,
        userId:      txn.edited_by_user_id || null,
        lines: origLines.map((l) => ({
          accountId: l.account_id, debit: parseFloat(l.credit), credit: parseFloat(l.debit),
          description: l.description, entityType: l.entity_type, entityId: l.entity_id,
        })),
      });
      return;
    }

    // Case 2: no individual JE — check if a summary covers this transaction
    const covered = await _isCoveredBySummary(client, companyId, txn.transaction_id);
    if (!covered) return;

    const accIds = await findAccIds(client, companyId, ['1000', '1010', '1200', '2100', '4000', '5000']);
    if (!accIds['4000']) return;

    const result = await _buildSaleReversalLines(client, companyId, txn.transaction_id, accIds);
    if (!result || result.lines.length < 2) return;

    await _post(client, companyId, {
      entryDate:   new Date().toISOString().slice(0, 10),
      description: `Edit reversal — ${result.txnNumber}`,
      sourceType:  'SALE_EDIT',
      sourceId:    txn.transaction_id,
      userId:      txn.edited_by_user_id || null,
      lines:       result.lines,
    });
  } catch (err) {
    console.error('[ledger] postSaleEditReversal skipped:', err.message);
  }
}

// ── GRN Entry ─────────────────────────────────────────────────────────────────
// DR Inventory (1200), CR AP (2000) — linked to supplier
async function postGrnEntry(client, companyId, grn) {
  try {
    const accIds = await findAccIds(client, companyId, ['1200', '2000']);
    if (!accIds['1200'] || !accIds['2000']) return;

    const amt = parseFloat(grn.total_amount);
    if (amt <= 0.005) return;

    await _post(client, companyId, {
      entryDate:   toDateStr(grn.received_date),
      description: `Goods received ${grn.grn_number}`,
      sourceType:  'GRN',
      sourceId:    grn.grn_id,
      userId:      grn.received_by_user_id || null,
      lines: [
        { accountId: accIds['1200'], debit: +amt.toFixed(4), credit: 0 },
        {
          accountId:  accIds['2000'],
          debit:      0,
          credit:     +amt.toFixed(4),
          entityType: grn.supplier_id ? 'supplier' : null,
          entityId:   grn.supplier_id || null,
        },
      ],
    });
  } catch (err) {
    console.error('[ledger] postGrnEntry skipped:', err.message);
  }
}

// ── Helpers: resolve the GL account for a bank/cash payment line ──────────────
// Priority: linked bank account's GL account_id → method-name heuristic → 1000
async function resolveBankAccId(client, companyId, payment, fallbackAccIds) {
  if (payment.bank_account_id) {
    const { rows } = await client.query(
      `SELECT account_id FROM bank_accounts WHERE bank_account_id = $1 AND company_id = $2`,
      [payment.bank_account_id, companyId]
    );
    if (rows.length && rows[0].account_id) {
      return { accId: rows[0].account_id, entityId: payment.bank_account_id };
    }
  }
  // Fall back to method-name heuristic
  const method = (payment.payment_method || '').toLowerCase();
  const isBank = method.includes('bank') || method.includes('transfer') || method.includes('cheque');
  return {
    accId:    isBank && fallbackAccIds['1010'] ? fallbackAccIds['1010'] : fallbackAccIds['1000'],
    entityId: null,
  };
}

// ── Supplier Payment Entry ────────────────────────────────────────────────────
// DR AP (2000) — linked to supplier, CR selected bank/cash account
async function postPaymentEntry(client, companyId, payment) {
  try {
    const accIds = await findAccIds(client, companyId, ['1000', '1010', '2000']);
    if (!accIds['2000']) return;

    const amt = parseFloat(payment.amount);
    if (amt <= 0.005) return;

    const { accId: crAccId, entityId: bankEntityId } =
      await resolveBankAccId(client, companyId, payment, accIds);
    if (!crAccId) return;

    await _post(client, companyId, {
      entryDate:   toDateStr(payment.payment_date),
      description: `Supplier payment — ${payment.reference_number || payment.payment_id}`,
      sourceType:  'PAYMENT',
      sourceId:    payment.payment_id,
      userId:      payment.created_by_user_id || null,
      lines: [
        {
          accountId:  accIds['2000'],
          debit:      +amt.toFixed(4),
          credit:     0,
          entityType: payment.supplier_id ? 'supplier' : null,
          entityId:   payment.supplier_id || null,
        },
        {
          accountId:  crAccId,
          debit:      0,
          credit:     +amt.toFixed(4),
          entityType: bankEntityId ? 'bank_account' : null,
          entityId:   bankEntityId || null,
        },
      ],
    });
  } catch (err) {
    console.error('[ledger] postPaymentEntry skipped:', err.message);
  }
}

// ── Void Payment Entry ────────────────────────────────────────────────────────
// Reversal: DR selected bank/cash account, CR AP (2000) — linked to supplier
async function postVoidPaymentEntry(client, companyId, payment, userId) {
  try {
    const accIds = await findAccIds(client, companyId, ['1000', '1010', '2000']);
    if (!accIds['2000']) return;

    const amt = parseFloat(payment.amount);
    if (amt <= 0.005) return;

    const { accId: drAccId, entityId: bankEntityId } =
      await resolveBankAccId(client, companyId, payment, accIds);
    if (!drAccId) return;

    await _post(client, companyId, {
      entryDate:   toDateStr(new Date()),
      description: `Void payment — ${payment.reference_number || payment.payment_id}`,
      sourceType:  'PAYMENT_VOID',
      sourceId:    payment.payment_id,
      userId:      userId || null,
      lines: [
        {
          accountId:  drAccId,
          debit:      +amt.toFixed(4),
          credit:     0,
          entityType: bankEntityId ? 'bank_account' : null,
          entityId:   bankEntityId || null,
        },
        {
          accountId:  accIds['2000'],
          debit:      0,
          credit:     +amt.toFixed(4),
          entityType: payment.supplier_id ? 'supplier' : null,
          entityId:   payment.supplier_id || null,
        },
      ],
    });
  } catch (err) {
    console.error('[ledger] postVoidPaymentEntry skipped:', err.message);
  }
}

// ── Direct Expense Entry ──────────────────────────────────────────────────────
// Multiple DR expense lines, single CR bank/cash account
async function postDirectExpenseEntry(client, companyId, payment) {
  try {
    const lines = Array.isArray(payment.expense_lines) ? payment.expense_lines : [];
    if (!lines.length) return;

    const total = lines.reduce((s, l) => s + parseFloat(l.amount || 0), 0);
    if (total <= 0.005) return;

    const accIds = await findAccIds(client, companyId, ['1000', '1010']);
    const { accId: crAccId, entityId: bankEntityId } =
      await resolveBankAccId(client, companyId, payment, accIds);
    if (!crAccId) return;

    const firstPayee = lines[0]?.payeeName || payment.reference_number || payment.payment_id;

    await _post(client, companyId, {
      entryDate:   toDateStr(payment.payment_date),
      description: `Direct expense — ${firstPayee}`,
      sourceType:  'PAYMENT',
      sourceId:    payment.payment_id,
      userId:      payment.created_by_user_id || null,
      lines: [
        ...lines.map((l) => ({
          accountId:   l.accountId,
          debit:       +parseFloat(l.amount).toFixed(4),
          credit:      0,
          description: l.payeeName || null,
        })),
        {
          accountId:  crAccId,
          debit:      0,
          credit:     +total.toFixed(4),
          entityType: bankEntityId ? 'bank_account' : null,
          entityId:   bankEntityId || null,
        },
      ],
    });
  } catch (err) {
    console.error('[ledger] postDirectExpenseEntry skipped:', err.message);
  }
}

// Reversal of direct expense — DR bank, CR each expense account
async function postVoidDirectExpenseEntry(client, companyId, payment, userId) {
  try {
    const lines = Array.isArray(payment.expense_lines) ? payment.expense_lines : [];
    if (!lines.length) return;

    const total = lines.reduce((s, l) => s + parseFloat(l.amount || 0), 0);
    if (total <= 0.005) return;

    const accIds = await findAccIds(client, companyId, ['1000', '1010']);
    const { accId: drAccId, entityId: bankEntityId } =
      await resolveBankAccId(client, companyId, payment, accIds);
    if (!drAccId) return;

    await _post(client, companyId, {
      entryDate:   toDateStr(new Date()),
      description: `Void direct expense — ${lines[0]?.payeeName || payment.reference_number || payment.payment_id}`,
      sourceType:  'PAYMENT_VOID',
      sourceId:    payment.payment_id,
      userId:      userId || null,
      lines: [
        {
          accountId:  drAccId,
          debit:      +total.toFixed(4),
          credit:     0,
          entityType: bankEntityId ? 'bank_account' : null,
          entityId:   bankEntityId || null,
        },
        ...lines.map((l) => ({
          accountId:   l.accountId,
          debit:       0,
          credit:      +parseFloat(l.amount).toFixed(4),
          description: l.payeeName || null,
        })),
      ],
    });
  } catch (err) {
    console.error('[ledger] postVoidDirectExpenseEntry skipped:', err.message);
  }
}

// ── Return Entry ──────────────────────────────────────────────────────────────
// DR Revenue (4000) + DR VAT Payable (2100), CR Cash/Bank per refund method
// If restocked: DR Inventory (1200), CR COGS (5000)
async function postReturnEntry(client, companyId, ret, items, refunds) {
  try {
    const accIds = await findAccIds(client, companyId, ['1000', '1010', '1200', '2100', '4000', '5000']);
    if (!accIds['4000']) return;

    const totalRefunded    = parseFloat(ret.total_refunded    || 0);
    const subtotalRefunded = parseFloat(ret.subtotal_refunded || totalRefunded);
    const taxRefunded      = +(totalRefunded - subtotalRefunded).toFixed(4);
    if (totalRefunded <= 0.005) return;

    const pmIds = [...new Set(refunds.map((r) => r.payment_method_id || r.paymentMethodId))].filter(Boolean);
    let pmMap = {};
    if (pmIds.length) {
      const { rows: pms } = await client.query(
        `SELECT payment_method_id, method_name FROM payment_methods WHERE payment_method_id = ANY($1)`,
        [pmIds]
      );
      pmMap = Object.fromEntries(pms.map((pm) => [pm.payment_method_id, pm.method_name]));
    }

    const restockedItems = items.filter(
      (i) => i.return_to_inventory !== false && i.returnToInventory !== false
    );
    let totalRestockCost = 0;
    if (restockedItems.length && accIds['1200'] && accIds['5000']) {
      const pids = [...new Set(restockedItems.map((i) => i.product_id || i.productId))];
      const { rows: prods } = await client.query(
        `SELECT product_id, COALESCE(cost_price, 0)::numeric AS cost_price FROM products WHERE product_id = ANY($1)`,
        [pids]
      );
      const costMap = Object.fromEntries(prods.map((p) => [p.product_id, parseFloat(p.cost_price)]));
      totalRestockCost = restockedItems.reduce((s, i) => {
        const pid = i.product_id || i.productId;
        const qty = parseFloat(i.quantity_returned || i.quantityReturned || 0);
        return s + qty * (costMap[pid] || 0);
      }, 0);
    }

    const customerId = ret.customer_id || ret.customerId || null;
    const lines = [];

    // DR: Revenue reduced — linked to customer if known
    lines.push({
      accountId:  accIds['4000'],
      debit:      +subtotalRefunded.toFixed(4),
      credit:     0,
      entityType: customerId ? 'customer' : null,
      entityId:   customerId,
    });

    // DR: VAT Payable reduced
    if (taxRefunded > 0.005 && accIds['2100']) {
      lines.push({ accountId: accIds['2100'], debit: +taxRefunded.toFixed(4), credit: 0 });
    }

    // CR: Cash/Bank per refund method
    for (const refund of refunds) {
      const pmId       = refund.payment_method_id || refund.paymentMethodId;
      const methodName = (pmMap[pmId] || '').toLowerCase();
      const isBank     = methodName.includes('bank') || methodName.includes('transfer') || methodName.includes('cheque');
      const crAccId    = isBank && accIds['1010'] ? accIds['1010'] : accIds['1000'];
      if (!crAccId) continue;
      const amt = parseFloat(refund.amount_refunded || refund.amountRefunded || 0);
      if (amt > 0.005) lines.push({ accountId: crAccId, debit: 0, credit: +amt.toFixed(4) });
    }

    // DR Inventory + CR COGS for restocked items
    if (totalRestockCost > 0.005) {
      lines.push({ accountId: accIds['1200'], debit: +totalRestockCost.toFixed(4), credit: 0 });
      lines.push({ accountId: accIds['5000'], debit: 0, credit: +totalRestockCost.toFixed(4) });
    }

    if (lines.length < 2) return;

    await _post(client, companyId, {
      entryDate:   toDateStr(ret.return_date),
      description: `Sales return ${ret.return_number}`,
      sourceType:  'RETURN',
      sourceId:    ret.return_id,
      userId:      ret.processed_by_user_id || null,
      lines,
    });
  } catch (err) {
    console.error('[ledger] postReturnEntry skipped:', err.message);
  }
}

// ── Bank Opening Balance Entry ─────────────────────────────────────────────────
// DR linked CoA account (or 1010), CR Owner's Capital (3000)
// Bank account line linked to bank_account entity
async function postOpeningBalanceEntry(client, companyId, bankAccount) {
  try {
    const openingBalance = parseFloat(bankAccount.opening_balance || 0);
    if (openingBalance <= 0.005) return;

    const accIds = await findAccIds(client, companyId, ['1010', '3000']);
    if (!accIds['3000']) return;

    const drAccId = bankAccount.account_id || accIds['1010'];
    if (!drAccId) return;

    await _post(client, companyId, {
      entryDate:   toDateStr(new Date()),
      description: `Opening balance — ${bankAccount.account_name}`,
      sourceType:  'OPENING',
      sourceId:    bankAccount.bank_account_id,
      userId:      null,
      lines: [
        {
          accountId:  drAccId,
          debit:      +openingBalance.toFixed(4),
          credit:     0,
          entityType: 'bank_account',
          entityId:   bankAccount.bank_account_id,
        },
        { accountId: accIds['3000'], debit: 0, credit: +openingBalance.toFixed(4) },
      ],
    });
  } catch (err) {
    console.error('[ledger] postOpeningBalanceEntry skipped:', err.message);
  }
}

// ── REMOVED: bulkImportEntries, postManualEntry, voidJournalEntry, listJournalEntries, getJournalEntry
// These functions now live in modules/journals/journals.service.js (operational journal documents).
// This file retains only system auto-posting functions + reconciliation utilities.

// ── Bulk Import (legacy stub — kept so existing imports don't break during transition) ──
async function bulkImportEntries(companyId, userId, entries) {
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
      const lines = entry.lines.map((l) => ({
        accountId:   codeMap[l.accountCode],
        debit:       parseFloat(l.debit  || 0),
        credit:      parseFloat(l.credit || 0),
        description: l.description || null,
      }));
      await _post(client, companyId, {
        entryDate:   entry.entryDate,
        description: entry.description || 'Imported entry',
        sourceType:  'MANUAL',
        sourceId:    null,
        userId,
        lines,
      });
      imported++;
    }
    return { imported };
  });
}

// ── Manual Journal Entry ───────────────────────────────────────────────────────
async function postManualEntry(companyId, userId, data) {
  const { entryDate, description, lines } = data;
  if (!lines?.length) throw AppError.badRequest('At least one line is required');

  for (const l of lines) {
    if (!l.accountId) throw AppError.badRequest('Each line requires accountId');
    if ((l.debit  || 0) < 0 || (l.credit || 0) < 0)
      throw AppError.badRequest('Debit/credit cannot be negative');
    if ((l.debit  || 0) > 0 && (l.credit || 0) > 0)
      throw AppError.badRequest('A line cannot carry both debit and credit');
  }

  return transaction(async (client) => {
    const uniqueIds = [...new Set(lines.map((l) => l.accountId))];
    const { rows: accs } = await client.query(
      `SELECT account_id FROM accounts WHERE company_id = $1 AND account_id = ANY($2) AND is_active = TRUE`,
      [companyId, uniqueIds]
    );
    if (accs.length !== uniqueIds.length)
      throw AppError.badRequest('One or more accounts not found or inactive');

    return _post(client, companyId, {
      entryDate:   entryDate || new Date().toISOString().slice(0, 10),
      description: description || null,
      sourceType:  'MANUAL',
      sourceId:    null,
      userId,
      lines: lines.map((l) => ({
        accountId:   l.accountId,
        debit:       parseFloat(l.debit)  || 0,
        credit:      parseFloat(l.credit) || 0,
        description: l.description || null,
        entityType:  l.entityType  || null,
        entityId:    l.entityId    || null,
      })),
    });
  });
}

// ── Void a Posted Entry ────────────────────────────────────────────────────────
// Creates a reversal entry; marks original as void (immutable audit trail)
async function voidJournalEntry(companyId, jeId, userId, reason) {
  return transaction(async (client) => {
    const { rows: [je] } = await client.query(
      `SELECT * FROM journal_entries WHERE journal_entry_id = $1 AND company_id = $2 FOR UPDATE`,
      [jeId, companyId]
    );
    if (!je)                  throw AppError.notFound('Journal entry');
    if (je.status === 'void') throw AppError.conflict('Journal entry is already voided');

    await client.query(`
      UPDATE journal_entries
      SET status = 'void', voided_by_user_id = $2, voided_at = now(), void_reason = $3
      WHERE journal_entry_id = $1
    `, [jeId, userId, reason || null]);

    // Copy original lines (including entity linkage) for the reversal
    const { rows: origLines } = await client.query(
      `SELECT account_id, debit, credit, description, entity_type, entity_id
       FROM ledger_entry_lines WHERE journal_entry_id = $1`,
      [jeId]
    );

    const reversalLines = origLines.map((l) => ({
      accountId:   l.account_id,
      debit:       parseFloat(l.credit),
      credit:      parseFloat(l.debit),
      description: l.description,
      entityType:  l.entity_type,
      entityId:    l.entity_id,
    }));

    return _post(client, companyId, {
      entryDate:   new Date().toISOString().slice(0, 10),
      description: `Reversal of ${je.entry_number}${reason ? ': ' + reason : ''}`,
      sourceType:  'VOID',
      sourceId:    jeId,
      userId,
      lines: reversalLines,
    });
  });
}

// ── Bulk Opening Balance Entry ─────────────────────────────────────────────────
async function postBulkOpeningBalance(companyId, userId, entries) {
  if (!entries?.length) throw AppError.badRequest('At least one entry required');

  return transaction(async (client) => {
    const accIds = await findAccIds(client, companyId, ['3000']);
    if (!accIds['3000']) throw AppError.badRequest('Equity account (3000) not found — seed the Chart of Accounts first');

    const lines = [];
    let equityCredit = 0;
    let equityDebit  = 0;

    for (const e of entries) {
      const amt = parseFloat(e.amount || 0);
      if (amt <= 0.005) continue;
      const dr = e.normalBalance === 'debit';
      lines.push({
        accountId:   e.accountId,
        debit:       dr ? +amt.toFixed(4) : 0,
        credit:      dr ? 0 : +amt.toFixed(4),
        description: e.description || null,
      });
      if (dr) equityCredit += amt;
      else    equityDebit  += amt;
    }

    if (!lines.length) throw AppError.badRequest('All amounts are zero');

    const netEquity = equityCredit - equityDebit;
    if (Math.abs(netEquity) > 0.005) {
      lines.push({
        accountId: accIds['3000'],
        debit:     netEquity < 0 ? +Math.abs(netEquity).toFixed(4) : 0,
        credit:    netEquity > 0 ? +netEquity.toFixed(4)            : 0,
      });
    }

    return _post(client, companyId, {
      entryDate:   new Date().toISOString().slice(0, 10),
      description: 'Opening balances',
      sourceType:  'OPENING',
      sourceId:    null,
      userId,
      lines,
    });
  });
}

// ── AR Settlement Entry ────────────────────────────────────────────────────────
// Customer pays their credit balance: DR Cash/Bank, CR AR (1100) — linked to customer
async function postArSettlementEntry(companyId, userId, { transactionId, amount, paymentMethodId }) {
  if (!transactionId) throw AppError.badRequest('transactionId required');
  const amt = parseFloat(amount || 0);
  if (amt <= 0.005) throw AppError.badRequest('Amount must be positive');

  return transaction(async (client) => {
    const accIds = await findAccIds(client, companyId, ['1000', '1010', '1100']);
    if (!accIds['1100']) throw AppError.badRequest('AR account (1100) not found');

    // Outstanding balance check
    const { rows: [bal] } = await client.query(`
      SELECT COALESCE(
        SUM(lel.debit)  FILTER (WHERE je.source_type = 'SALE'),         0
      ) - COALESCE(
        SUM(lel.credit) FILTER (WHERE je.source_type = 'AR_SETTLEMENT'), 0
      ) AS outstanding
      FROM ledger_entry_lines lel
      JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
      WHERE je.company_id = $1 AND je.status = 'posted'
        AND je.source_id  = $2
        AND lel.account_id = $3
    `, [companyId, transactionId, accIds['1100']]);

    const outstanding = parseFloat(bal?.outstanding || 0);
    if (amt > outstanding + 0.005)
      throw AppError.badRequest(`Amount ${amt.toFixed(2)} exceeds outstanding AR ${outstanding.toFixed(2)}`);

    // Classify payment method
    let drAccId = accIds['1000'];
    if (paymentMethodId) {
      const { rows: [pm] } = await client.query(
        `SELECT method_name FROM payment_methods WHERE payment_method_id = $1`, [paymentMethodId]
      );
      const name = (pm?.method_name || '').toLowerCase();
      if ((name.includes('bank') || name.includes('transfer') || name.includes('cheque')) && accIds['1010'])
        drAccId = accIds['1010'];
    }
    if (!drAccId) throw AppError.badRequest('Cash/Bank account not found');

    // Fetch transaction details (customer + number)
    const { rows: [st] } = await client.query(
      `SELECT transaction_number, customer_id FROM sales_transactions WHERE transaction_id = $1`,
      [transactionId]
    );
    const customerId = st?.customer_id || null;

    return _post(client, companyId, {
      entryDate:   new Date().toISOString().slice(0, 10),
      description: `AR collection — ${st?.transaction_number || transactionId}`,
      sourceType:  'AR_SETTLEMENT',
      sourceId:    transactionId,
      userId,
      lines: [
        { accountId: drAccId,         debit: +amt.toFixed(4), credit: 0 },
        {
          accountId:  accIds['1100'],
          debit:      0,
          credit:     +amt.toFixed(4),
          entityType: customerId ? 'customer' : null,
          entityId:   customerId,
        },
      ],
    });
  });
}

// ── AR Aging ───────────────────────────────────────────────────────────────────
async function getArAging(companyId) {
  const { rows } = await query(`
    WITH ar_sales AS (
      SELECT je.journal_entry_id, je.source_id AS transaction_id, je.entry_date,
             COALESCE(SUM(lel.debit), 0)::numeric AS ar_debit
      FROM journal_entries je
      JOIN ledger_entry_lines lel ON lel.journal_entry_id = je.journal_entry_id
      JOIN accounts a              ON a.account_id = lel.account_id AND a.account_code = '1100'
      WHERE ($1::uuid IS NULL OR je.company_id = $1::uuid) AND je.status = 'posted' AND je.source_type = 'SALE'
      GROUP BY je.journal_entry_id, je.source_id, je.entry_date
      HAVING COALESCE(SUM(lel.debit), 0) > 0.005
    ),
    ar_settled AS (
      SELECT je.source_id AS transaction_id,
             COALESCE(SUM(lel.credit), 0)::numeric AS cr_total
      FROM journal_entries je
      JOIN ledger_entry_lines lel ON lel.journal_entry_id = je.journal_entry_id
      JOIN accounts a              ON a.account_id = lel.account_id AND a.account_code = '1100'
      WHERE ($1::uuid IS NULL OR je.company_id = $1::uuid) AND je.status = 'posted' AND je.source_type = 'AR_SETTLEMENT'
      GROUP BY je.source_id
    )
    SELECT
      s.transaction_id,
      st.transaction_number,
      st.transaction_date,
      COALESCE(c.customer_name, 'Walk-in') AS customer_name,
      s.ar_debit,
      COALESCE(sett.cr_total, 0)                       AS ar_settled,
      (s.ar_debit - COALESCE(sett.cr_total, 0))        AS outstanding,
      (CURRENT_DATE - s.entry_date)                    AS days_outstanding
    FROM ar_sales s
    JOIN sales_transactions st ON st.transaction_id = s.transaction_id
    LEFT JOIN customers c      ON c.customer_id     = st.customer_id
    LEFT JOIN ar_settled sett  ON sett.transaction_id = s.transaction_id
    WHERE (s.ar_debit - COALESCE(sett.cr_total, 0)) > 0.005
    ORDER BY s.entry_date ASC
  `, [companyId]);

  const bucket = (days) => {
    if (!days || days <= 30) return 'current';
    if (days <= 60) return '31_60';
    if (days <= 90) return '61_90';
    return 'over_90';
  };

  const receivables = rows.map((r) => {
    const days = parseInt(r.days_outstanding) || 0;
    return {
      transactionId:     r.transaction_id,
      transactionNumber: r.transaction_number,
      transactionDate:   r.transaction_date,
      customerName:      r.customer_name,
      arCreated:         parseFloat(r.ar_debit),
      arSettled:         parseFloat(r.ar_settled),
      outstanding:       parseFloat(r.outstanding),
      daysOutstanding:   days,
      bucket:            bucket(days),
    };
  });

  const totals = { current: 0, '31_60': 0, '61_90': 0, over_90: 0, total: 0 };
  for (const r of receivables) { totals[r.bucket] += r.outstanding; totals.total += r.outstanding; }

  return { receivables, totals };
}

// ── Unreconciled Cash Lines ────────────────────────────────────────────────────
async function getUnreconciledLines(companyId, { bankAccountId, startDate, endDate } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);

  const conds = [
    'je.company_id = $1', "je.status = 'posted'",
    'je.entry_date BETWEEN $2 AND $3',
    'NOT lel.is_reconciled',
    "a.account_code IN ('1000', '1010')",
  ];
  const vals = [companyId, start, end];

  if (bankAccountId) {
    const { rows: [ba] } = await query(
      `SELECT account_id FROM bank_accounts WHERE bank_account_id = $1 AND company_id = $2`,
      [bankAccountId, companyId]
    );
    if (ba?.account_id) { vals.push(ba.account_id); conds.push(`lel.account_id = $${vals.length}`); }
  }

  const { rows } = await query(`
    SELECT
      lel.line_id,
      je.journal_entry_id,
      je.entry_number,
      je.entry_date,
      je.source_type,
      COALESCE(lel.description, je.description) AS description,
      lel.debit::numeric,
      lel.credit::numeric,
      a.account_code,
      a.account_name
    FROM ledger_entry_lines lel
    JOIN journal_entries je ON je.journal_entry_id = lel.journal_entry_id
    JOIN accounts a         ON a.account_id = lel.account_id
    WHERE ${conds.join(' AND ')}
    ORDER BY je.entry_date DESC, je.entry_number DESC
  `, vals);

  return {
    period: { startDate: start, endDate: end },
    lines: rows.map((r) => ({
      lineId:      r.line_id,
      entryId:     r.journal_entry_id,
      entryNumber: r.entry_number,
      entryDate:   r.entry_date,
      sourceType:  r.source_type,
      description: r.description,
      debit:       parseFloat(r.debit),
      credit:      parseFloat(r.credit),
      accountCode: r.account_code,
      accountName: r.account_name,
    })),
  };
}

// ── Reconcile Lines ────────────────────────────────────────────────────────────
async function reconcileLines(companyId, userId, lineIds) {
  if (!lineIds?.length) throw AppError.badRequest('No line IDs provided');

  const { rowCount } = await query(`
    UPDATE ledger_entry_lines lel
    SET is_reconciled = TRUE, reconciled_at = now(), reconciled_by_user_id = $3
    FROM journal_entries je
    WHERE lel.journal_entry_id = je.journal_entry_id
      AND je.company_id = $1
      AND lel.line_id   = ANY($2)
      AND NOT lel.is_reconciled
  `, [companyId, lineIds, userId]);

  return { reconciled: rowCount };
}

// ── List Journal Entries ───────────────────────────────────────────────────────
async function listJournalEntries(companyId, { startDate, endDate, sourceType, status, page = 1, limit = 25 } = {}) {
  const start = startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const pg = parseInt(page,  10);
  const lm = parseInt(limit, 10);

  const conds = ['je.company_id = $1', 'je.entry_date BETWEEN $2 AND $3'];
  const vals  = [companyId, start, end];

  if (sourceType) { vals.push(sourceType); conds.push(`je.source_type = $${vals.length}`); }
  if (status)     { vals.push(status);     conds.push(`je.status = $${vals.length}`);       }

  vals.push(lm, (pg - 1) * lm);

  const { rows } = await query(`
    SELECT je.journal_entry_id, je.entry_number, je.entry_date, je.description,
           je.source_type, je.status,
           u.first_name || ' ' || u.last_name AS created_by,
           COALESCE(SUM(lel.debit),  0)::numeric AS total_debit,
           COALESCE(SUM(lel.credit), 0)::numeric AS total_credit,
           COUNT(*) OVER()                        AS total_count
    FROM journal_entries je
    LEFT JOIN users u                ON u.user_id           = je.created_by_user_id
    LEFT JOIN ledger_entry_lines lel ON lel.journal_entry_id = je.journal_entry_id
    WHERE ${conds.join(' AND ')}
    GROUP BY je.journal_entry_id, u.first_name, u.last_name
    ORDER BY je.entry_date DESC, je.entry_number DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    entries: rows.map(({ total_count, ...r }) => ({
      journalEntryId: r.journal_entry_id,
      entryNumber:    r.entry_number,
      entryDate:      r.entry_date,
      description:    r.description,
      sourceType:     r.source_type,
      status:         r.status,
      createdBy:      r.created_by,
      totalDebit:     parseFloat(r.total_debit),
      totalCredit:    parseFloat(r.total_credit),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

// ── Get Single Entry with Lines ────────────────────────────────────────────────
async function getJournalEntry(companyId, jeId) {
  const { rows: [je] } = await query(`
    SELECT je.*,
           u.first_name || ' ' || u.last_name AS created_by,
           v.first_name || ' ' || v.last_name AS voided_by
    FROM journal_entries je
    LEFT JOIN users u ON u.user_id = je.created_by_user_id
    LEFT JOIN users v ON v.user_id = je.voided_by_user_id
    WHERE je.journal_entry_id = $1 AND je.company_id = $2
  `, [jeId, companyId]);
  if (!je) throw AppError.notFound('Journal entry');

  const { rows: lines } = await query(`
    SELECT
      lel.line_id, lel.account_id, lel.description,
      lel.debit::numeric, lel.credit::numeric, lel.line_order,
      lel.entity_type, lel.entity_id,
      a.account_code, a.account_name, a.account_type,
      CASE lel.entity_type
        WHEN 'customer'     THEN c.customer_name
        WHEN 'supplier'     THEN s.supplier_name
        WHEN 'bank_account' THEN ba.account_name
      END AS entity_name
    FROM ledger_entry_lines lel
    JOIN accounts a ON a.account_id = lel.account_id
    LEFT JOIN customers     c  ON lel.entity_type = 'customer'     AND c.customer_id      = lel.entity_id
    LEFT JOIN suppliers     s  ON lel.entity_type = 'supplier'     AND s.supplier_id      = lel.entity_id
    LEFT JOIN bank_accounts ba ON lel.entity_type = 'bank_account' AND ba.bank_account_id = lel.entity_id
    WHERE lel.journal_entry_id = $1
    ORDER BY lel.line_order
  `, [jeId]);

  return {
    ...je,
    lines: lines.map((l) => ({
      lineId:      l.line_id,
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
    })),
  };
}

module.exports = {
  findAccIds, _post,
  postSaleEntry, postSaleVoidEntry, postSaleEditReversal, postGrnEntry,
  postSessionSummaryEntry, postDailySummaryEntry,
  postPaymentEntry, postVoidPaymentEntry,
  postDirectExpenseEntry, postVoidDirectExpenseEntry,
  postReturnEntry, postOpeningBalanceEntry,
  postBulkOpeningBalance, postArSettlementEntry,
  postManualEntry, bulkImportEntries, voidJournalEntry,
  getArAging, getUnreconciledLines, reconcileLines,
  listJournalEntries, getJournalEntry,
};
