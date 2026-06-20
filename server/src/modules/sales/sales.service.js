const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const { isCompanyWide } = require('../../shared/roles');
const QueryBuilder = require('../../shared/qb');
const jrn = require('../journal/journal.service');
const { recordMovement } = require('../inventory/movements.service');

// ── FIFO helpers ─────────────────────────────────────────────────────────────

async function consumeFifoLayers(client, companyId, branchId, productId, qtyNeeded) {
  const { rows: layers } = await client.query(`
    SELECT layer_id, qty_remaining::numeric, unit_cost::numeric
    FROM inventory_cost_layers
    WHERE company_id=$1 AND branch_id=$2 AND product_id=$3 AND qty_remaining > 0
    ORDER BY received_at ASC
    FOR UPDATE
  `, [companyId, branchId, productId]);

  let remaining = qtyNeeded;
  let totalCost = 0;

  for (const layer of layers) {
    if (remaining <= 0.0001) break;
    const take = Math.min(remaining, parseFloat(layer.qty_remaining));
    totalCost += take * parseFloat(layer.unit_cost);
    remaining -= take;
    await client.query(
      `UPDATE inventory_cost_layers SET qty_remaining = qty_remaining - $1 WHERE layer_id = $2`,
      [take, layer.layer_id]
    );
  }

  if (remaining > 0.0001) {
    // Pre-FIFO stock: fall back to products.cost_price
    const { rows: [p] } = await client.query(
      `SELECT COALESCE(cost_price, 0)::numeric AS cost_price FROM products WHERE product_id = $1`,
      [productId]
    );
    totalCost += remaining * parseFloat(p?.cost_price || 0);
  }

  return { totalCost: +totalCost.toFixed(4) };
}

async function returnFifoLayers(client, companyId, branchId, productId, qty) {
  const { rows: [agg] } = await client.query(`
    SELECT COALESCE(
      SUM(qty_remaining * unit_cost)::numeric / NULLIF(SUM(qty_remaining), 0), 0
    )::numeric AS wac
    FROM inventory_cost_layers
    WHERE company_id=$1 AND branch_id=$2 AND product_id=$3 AND qty_remaining > 0
  `, [companyId, branchId, productId]);

  let returnCost = parseFloat(agg?.wac || 0);
  if (returnCost <= 0) {
    const { rows: [p] } = await client.query(
      `SELECT COALESCE(cost_price, 0)::numeric AS cost_price FROM products WHERE product_id = $1`,
      [productId]
    );
    returnCost = parseFloat(p?.cost_price || 0);
  }

  await client.query(`
    INSERT INTO inventory_cost_layers
      (company_id, branch_id, product_id, grn_id, unit_cost, qty_original, qty_remaining, received_at)
    VALUES ($1, $2, $3, NULL, $4, $5, $5, now())
  `, [companyId, branchId, productId, returnCost, qty]);
}

// ─────────────────────────────────────────────────────────────────────────────

async function getLoyaltyRates(client, companyId) {
  const { rows } = await client.query(
    `SELECT points_earn_rate, points_redeem_rate FROM companies WHERE company_id = $1`,
    [companyId]
  );
  return rows.length
    ? { earnRate: parseFloat(rows[0].points_earn_rate), redeemRate: parseFloat(rows[0].points_redeem_rate) }
    : { earnRate: 10, redeemRate: 0.10 }; // safe fallback
}

async function createTransaction(companyId, branchId, cashierUserId, data) {
  const {
    sessionId, customerId, notes, items, payments,
    loyaltyPointsRedeemed = 0,
    orderDiscount = 0,
    idempotencyKey,
  } = data;

  if (!items?.length)    throw AppError.badRequest('Cart is empty');
  if (!payments?.length) throw AppError.badRequest('At least one payment is required');
  if (!branchId)         throw AppError.badRequest('Branch context is required');

  // Enforce "no sale below cost" when enabled for this company
  const { rows: coRows } = await query(
    `SELECT pos_prevent_sales_below_cost, costing_method, journal_posting_mode FROM companies WHERE company_id = $1`,
    [companyId]
  );
  const costingMethod   = coRows[0]?.costing_method       || 'weighted_average';
  const postingMode     = coRows[0]?.journal_posting_mode || 'per_transaction';
  if (coRows[0]?.pos_prevent_sales_below_cost) {
    const productIds = items.map((i) => i.productId);
    const { rows: costRows } = await query(
      `SELECT product_id, cost_price FROM products WHERE product_id = ANY($1::uuid[])`,
      [productIds]
    );
    const costMap = Object.fromEntries(costRows.map((r) => [r.product_id, parseFloat(r.cost_price ?? 0)]));
    for (const item of items) {
      const cost = costMap[item.productId] ?? 0;
      if (cost > 0) {
        // Use lineTotal/quantity (effective revenue per unit after discount) so that a
        // discount on a partial-quantity line cannot silently push the price below cost.
        const effectiveUnit = parseFloat(item.lineTotal) / parseFloat(item.quantity);
        if (effectiveUnit < cost) {
          throw AppError.badRequest(
            `One or more items are priced below purchase cost after discounts. Sales below cost are not allowed.`
          );
        }
      }
    }
  }

  // Offline idempotency: return existing transaction if key already committed
  if (idempotencyKey) {
    const { rows: existing } = await query(
      `SELECT transaction_id, transaction_number, transaction_date, total_amount, payment_status
       FROM sales_transactions WHERE company_id = $1 AND idempotency_key = $2`,
      [companyId, idempotencyKey]
    );
    if (existing.length) {
      return {
        transaction_id:        existing[0].transaction_id,
        transaction_number:    existing[0].transaction_number,
        transaction_date:      existing[0].transaction_date,
        total_amount:          parseFloat(existing[0].total_amount),
        payment_status:        existing[0].payment_status,
        loyalty_points_earned: 0,
        deduplicated:          true,
      };
    }
  }

  return transaction(async (client) => {
    // Atomic transaction counter — eliminates COUNT(*) race under concurrent inserts
    const { rows: ctrRows } = await client.query(
      `UPDATE companies SET txn_counter = txn_counter + 1 WHERE company_id = $1 RETURNING txn_counter`,
      [companyId]
    );
    const txnNumber = `TXN-${new Date().getFullYear()}-${String(ctrRows[0].txn_counter).padStart(6, '0')}`;

    const { earnRate, redeemRate } = await getLoyaltyRates(client, companyId);

    // lineTotal = qty × unitPrice − itemDiscount (VAT-inclusive price, what customer pays)
    // taxAmount = VAT extracted from lineTotal — stored for reporting, never added to total
    // total = Σ(lineTotal) − loyaltyDiscount − orderDiscount (VAT stays inside the price)
    const subtotal       = items.reduce((s, i) => s + parseFloat(i.lineTotal),      0);
    const taxAmount      = items.reduce((s, i) => s + parseFloat(i.taxAmount  || 0), 0);
    const itemDiscounts  = items.reduce((s, i) => s + parseFloat(i.discount   || 0), 0);
    const loyaltyDiscount = loyaltyPointsRedeemed * redeemRate;
    const discountAmt    = itemDiscounts + loyaltyDiscount + parseFloat(orderDiscount || 0);
    const totalAmount    = Math.max(0, subtotal - loyaltyDiscount - parseFloat(orderDiscount || 0));

    const totalPaid     = payments.reduce((s, p) => s + parseFloat(p.amountApplied || 0), 0);
    const paymentStatus = totalPaid >= totalAmount ? 'paid' : 'partial';

    const { rows: txnRows } = await client.query(`
      INSERT INTO sales_transactions (
        company_id, branch_id, cashier_user_id, pos_session_id,
        customer_id, transaction_number, subtotal, tax_amount,
        discount_amount, total_amount, status, payment_status, notes, idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed',$11,$12,$13)
      RETURNING transaction_id, transaction_number, transaction_date, total_amount, payment_status
    `, [companyId, branchId, cashierUserId, sessionId || null,
        customerId || null, txnNumber,
        subtotal, taxAmount, discountAmt, totalAmount, paymentStatus, notes || null,
        idempotencyKey || null]);

    const txn = txnRows[0];
    const cogsMap = costingMethod === 'fifo' ? {} : null;

    for (const item of items) {
      const { rows: stockRows } = await client.query(`
        SELECT quantity_available FROM product_branch_inventory
        WHERE product_id = $1 AND branch_id = $2
        FOR UPDATE
      `, [item.productId, branchId]);

      if (!stockRows.length) {
        throw AppError.unprocessable(`Product not found in branch inventory`);
      }
      const available = parseFloat(stockRows[0].quantity_available);
      if (available < parseFloat(item.quantity)) {
        throw AppError.unprocessable(`Insufficient stock (available: ${available})`);
      }

      await client.query(`
        INSERT INTO sales_transaction_items (
          transaction_id, product_id, quantity, unit_price,
          discount, tax_amount, line_total
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [txn.transaction_id, item.productId, parseFloat(item.quantity),
          parseFloat(item.unitPrice), parseFloat(item.discount || 0), parseFloat(item.taxAmount || 0), parseFloat(item.lineTotal)]);

      await client.query(`
        UPDATE product_branch_inventory
        SET quantity_available = quantity_available - $1, last_updated = now()
        WHERE product_id = $2 AND branch_id = $3
      `, [parseFloat(item.quantity), item.productId, branchId]);

      await recordMovement(client, {
        companyId, branchId, productId: item.productId,
        movementType:  'sale',
        qtyIn:         0,
        qtyOut:        parseFloat(item.quantity),
        qtyBefore:     available,
        qtyAfter:      available - parseFloat(item.quantity),
        referenceType: 'SALE',
        referenceId:   txn.transaction_id,
        referenceNo:   txnNumber,
        userId:        cashierUserId,
      });

      if (costingMethod === 'fifo') {
        const { totalCost } = await consumeFifoLayers(client, companyId, branchId, item.productId, parseFloat(item.quantity));
        cogsMap[item.productId] = (cogsMap[item.productId] || 0) + totalCost;
      }
    }

    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      await client.query(`
        INSERT INTO transaction_payments (
          transaction_id, payment_method_id, amount_tendered,
          amount_applied, change_given, reference_number, sequence_no
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [txn.transaction_id, p.paymentMethodId,
          p.amountTendered, p.amountApplied, p.changeGiven || 0,
          p.referenceNumber || null, i + 1]);
    }

    // Post double-entry journal for this sale (skipped in summary modes — posted at session/day close)
    if (postingMode === 'per_transaction') {
      await jrn.postSaleEntry(client, companyId, {
        ...txn,
        tax_amount:      taxAmount,
        cashier_user_id: cashierUserId,
      }, items, payments, cogsMap);
    }

    // Award & deduct loyalty points — atomic WHERE guards against concurrent overdraft
    let pointsEarned = 0;
    if (customerId) {
      pointsEarned = Math.floor(totalAmount / earnRate);
      const { rowCount } = await client.query(`
        UPDATE customers
        SET loyalty_points_balance = loyalty_points_balance + $2 - $3,
            updated_at = now()
        WHERE customer_id = $1
          AND loyalty_points_balance >= $3
      `, [customerId, pointsEarned, loyaltyPointsRedeemed]);
      if (rowCount === 0 && loyaltyPointsRedeemed > 0) {
        throw AppError.badRequest('Insufficient loyalty points — balance may have changed');
      }
    }

    return {
      transaction_id:        txn.transaction_id,
      transaction_number:    txn.transaction_number,
      transaction_date:      txn.transaction_date,
      total_amount:          parseFloat(txn.total_amount),
      payment_status:        txn.payment_status,
      loyalty_points_earned: pointsEarned,
    };
  });
}

async function listTransactions(companyId, role, branchIds, filters = {}) {
  const { branchId, search, status, paymentStatus, startDate, endDate, cashierId,
          paymentMethod, minAmount, maxAmount,
          posSessionId, sessionId,
          page = 1, limit = 25 } = filters;
  const resolvedSessionId = posSessionId || sessionId || null;
  const isWide = isCompanyWide(role);

  const qb = new QueryBuilder([companyId]);
  const conditions = ['st.company_id = $1'];

  if (!isWide) {
    const ids = branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000'];
    conditions.push(`st.branch_id = ANY($${qb.add(ids)})`);
  } else if (branchId) {
    conditions.push(`st.branch_id = $${qb.add(branchId)}`);
  }

  if (status) {
    conditions.push(`st.status = $${qb.add(status)}`);
  } else {
    conditions.push(`st.status != 'void'`);
  }

  if (search) {
    const p = qb.add(`%${search}%`);
    conditions.push(
      `(st.transaction_number ILIKE $${p} OR c.customer_name ILIKE $${p} OR (u.first_name || ' ' || u.last_name) ILIKE $${p})`
    );
  }
  if (paymentStatus)  conditions.push(`st.payment_status = $${qb.add(paymentStatus)}`);
  if (startDate)      conditions.push(`st.transaction_date::date >= $${qb.add(startDate)}`);
  if (endDate)        conditions.push(`st.transaction_date::date <= $${qb.add(endDate)}`);
  if (cashierId)      conditions.push(`st.cashier_user_id = $${qb.add(cashierId)}`);
  if (minAmount)      conditions.push(`st.total_amount >= $${qb.add(parseFloat(minAmount))}`);
  if (maxAmount)      conditions.push(`st.total_amount <= $${qb.add(parseFloat(maxAmount))}`);
  if (paymentMethod) {
    const pm = qb.add(`%${paymentMethod}%`);
    conditions.push(
      `EXISTS (SELECT 1 FROM transaction_payments tp2 JOIN payment_methods pm2 ON pm2.payment_method_id = tp2.payment_method_id WHERE tp2.transaction_id = st.transaction_id AND pm2.method_name ILIKE $${pm})`
    );
  }
  if (resolvedSessionId) conditions.push(`st.pos_session_id = $${qb.add(resolvedSessionId)}`);

  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const limIdx = qb.add(lm);
  const offIdx = qb.add((pg - 1) * lm);

  const { rows } = await query(`
    SELECT
      st.transaction_id, st.transaction_number, st.transaction_date,
      st.subtotal::numeric, st.tax_amount::numeric, st.discount_amount::numeric,
      st.total_amount::numeric, st.amount_paid::numeric, st.status, st.payment_status, st.return_status,
      COALESCE(c.customer_name, 'Walk-in') AS customer_name, c.customer_id,
      u.first_name || ' ' || u.last_name AS cashier_name,
      b.branch_name,
      (SELECT pm.method_name
       FROM transaction_payments tp
       JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
       WHERE tp.transaction_id = st.transaction_id
       ORDER BY tp.sequence_no LIMIT 1) AS payment_method,
      COALESCE((
        SELECT SUM(sti.quantity * COALESCE(p.cost_price, 0))
        FROM sales_transaction_items sti
        JOIN products p ON p.product_id = sti.product_id
        WHERE sti.transaction_id = st.transaction_id
      ), 0)::numeric AS cogs,
      COUNT(*) OVER() AS total_count
    FROM sales_transactions st
    LEFT JOIN customers c ON c.customer_id = st.customer_id
    JOIN users    u ON u.user_id   = st.cashier_user_id
    JOIN branches b ON b.branch_id = st.branch_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY st.transaction_date DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;

  return {
    transactions: rows.map((r) => ({
      transaction_id:     r.transaction_id,
      transaction_number: r.transaction_number,
      transaction_date:   r.transaction_date,
      subtotal:           parseFloat(r.subtotal),
      tax_amount:         parseFloat(r.tax_amount),
      discount_amount:    parseFloat(r.discount_amount),
      total_amount:       parseFloat(r.total_amount),
      amount_paid:        parseFloat(r.amount_paid),
      status:             r.status,
      payment_status:     r.payment_status,
      return_status:      r.return_status,
      customer_name:      r.customer_name,
      customer_id:        r.customer_id,
      cashier_name:       r.cashier_name,
      branch_name:        r.branch_name,
      payment_method:     r.payment_method || 'Cash',
      cogs:               parseFloat(r.cogs),
      profit:             parseFloat(r.total_amount) - parseFloat(r.tax_amount) - parseFloat(r.cogs),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

async function getTransaction(companyId, transactionId, role, branchIds = []) {
  const params = [companyId, transactionId];
  const conditions = ['st.company_id = $1', 'st.transaction_id = $2'];

  if (!isCompanyWide(role)) {
    params.push(branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000']);
    conditions.push(`st.branch_id = ANY($${params.length})`);
  }

  const { rows } = await query(`
    SELECT st.*,
      st.subtotal::numeric, st.tax_amount::numeric, st.discount_amount::numeric,
      st.total_amount::numeric, st.amount_paid::numeric, st.change_total::numeric,
      COALESCE(c.customer_name, 'Walk-in') AS customer_name, c.phone AS customer_phone,
      u.first_name || ' ' || u.last_name AS cashier_name,
      b.branch_name
    FROM sales_transactions st
    LEFT JOIN customers c ON c.customer_id = st.customer_id
    JOIN users    u ON u.user_id   = st.cashier_user_id
    JOIN branches b ON b.branch_id = st.branch_id
    WHERE ${conditions.join(' AND ')}
  `, params);

  if (!rows.length) throw AppError.notFound('Transaction');
  const txn = rows[0];

  const [itemsRes, paymentsRes] = await Promise.all([
    query(`
      SELECT sti.item_id, sti.product_id, sti.quantity::numeric, sti.unit_price::numeric,
        sti.discount::numeric AS discount_amount, sti.tax_amount::numeric, sti.line_total::numeric,
        p.product_name, p.sku
      FROM sales_transaction_items sti
      JOIN products p ON p.product_id = sti.product_id
      WHERE sti.transaction_id = $1
    `, [transactionId]),
    query(`
      SELECT tp.payment_id, tp.payment_method_id, tp.amount_tendered::numeric, tp.amount_applied::numeric,
        tp.change_given::numeric, tp.reference_number, tp.sequence_no, pm.method_name,
        pm.requires_reference
      FROM transaction_payments tp
      JOIN payment_methods pm ON pm.payment_method_id = tp.payment_method_id
      WHERE tp.transaction_id = $1 ORDER BY tp.sequence_no
    `, [transactionId]),
  ]);

  return {
    ...txn,
    total_amount:    parseFloat(txn.total_amount),
    subtotal:        parseFloat(txn.subtotal),
    tax_amount:      parseFloat(txn.tax_amount),
    discount_amount: parseFloat(txn.discount_amount),
    amount_paid:     parseFloat(txn.amount_paid),
    payment_status:  txn.payment_status,
    items:           itemsRes.rows,
    payments:        paymentsRes.rows,
  };
}

async function voidTransaction(companyId, transactionId, userId, reason, role, branchIds = []) {
  const params = [companyId, transactionId];
  const conditions = ['company_id = $1', 'transaction_id = $2'];

  if (!isCompanyWide(role)) {
    params.push(branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000']);
    conditions.push(`branch_id = ANY($${params.length})`);
  }

  const { rows } = await query(
    `SELECT status, branch_id, transaction_number FROM sales_transactions WHERE ${conditions.join(' AND ')}`,
    params
  );
  if (!rows.length) throw AppError.notFound('Transaction');
  if (rows[0].status !== 'completed') throw AppError.conflict('Only completed transactions can be voided');

  const branchId          = rows[0].branch_id;
  const transactionNumber = rows[0].transaction_number;

  return transaction(async (client) => {
    const { rows: [co] } = await client.query(
      `SELECT costing_method FROM companies WHERE company_id = $1`, [companyId]
    );
    const costingMethod = co?.costing_method || 'weighted_average';

    const { rows: items } = await client.query(
      `SELECT product_id, quantity FROM sales_transaction_items WHERE transaction_id = $1`,
      [transactionId]
    );
    for (const item of items) {
      const { rows: invRows } = await client.query(
        `SELECT quantity_available FROM product_branch_inventory
         WHERE product_id = $1 AND branch_id = $2 FOR UPDATE`,
        [item.product_id, branchId]
      );
      const qtyBefore = invRows.length ? parseFloat(invRows[0].quantity_available) : 0;
      const qtyAfter  = qtyBefore + parseFloat(item.quantity);
      await client.query(`
        UPDATE product_branch_inventory
        SET quantity_available = $1, last_updated = now()
        WHERE product_id = $2 AND branch_id = $3
      `, [qtyAfter, item.product_id, branchId]);

      await recordMovement(client, {
        companyId, branchId, productId: item.product_id,
        movementType:  'return',
        qtyIn:         parseFloat(item.quantity),
        qtyOut:        0,
        qtyBefore,
        qtyAfter,
        referenceType: 'VOID',
        referenceId:   transactionId,
        referenceNo:   transactionNumber,
        notes:         reason || null,
        userId,
      });

      if (costingMethod === 'fifo') {
        await returnFifoLayers(client, companyId, branchId, item.product_id, parseFloat(item.quantity));
      }
    }

    await client.query(`
      UPDATE sales_transactions
      SET status              = 'void',
          payment_status      = 'refunded',
          voided_by_user_id   = $3,
          voided_at           = now(),
          void_reason         = $4,
          updated_at          = now()
      WHERE company_id = $1 AND transaction_id = $2
    `, [companyId, transactionId, userId, reason || 'No reason provided']);

    await jrn.postSaleVoidEntry(client, companyId, {
      transaction_id:      transactionId,
      transaction_number:  transactionNumber,
      voided_by_user_id:   userId,
    });
  });
}

async function editTransaction(companyId, transactionId, userId, data, role, branchIds = []) {
  const { items, payments, customerId, notes, editReason, orderDiscount = 0 } = data;

  if (!items?.length)       throw AppError.badRequest('At least one item is required');
  if (!payments?.length)    throw AppError.badRequest('At least one payment is required');
  if (!editReason?.trim())  throw AppError.badRequest('Edit reason is required');

  // Fetch transaction with branch-scope access check
  const accessParams = [companyId, transactionId];
  const accessConds  = ['company_id = $1', 'transaction_id = $2'];
  if (!isCompanyWide(role)) {
    accessParams.push(branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000']);
    accessConds.push(`branch_id = ANY($${accessParams.length})`);
  }
  const { rows } = await query(
    `SELECT branch_id, transaction_number, transaction_date, cashier_user_id, status
     FROM sales_transactions WHERE ${accessConds.join(' AND ')}`,
    accessParams
  );
  if (!rows.length) throw AppError.notFound('Transaction');
  if (rows[0].status !== 'completed') throw AppError.conflict('Only completed transactions can be edited');

  const branchId          = rows[0].branch_id;
  const transactionNumber = rows[0].transaction_number;
  const transactionDate   = rows[0].transaction_date;
  const cashierUserId     = rows[0].cashier_user_id;

  // Enforce prevent-sales-below-cost policy
  const { rows: coRows } = await query(
    `SELECT pos_prevent_sales_below_cost, costing_method FROM companies WHERE company_id = $1`, [companyId]
  );
  const costingMethod = coRows[0]?.costing_method || 'weighted_average';
  if (coRows[0]?.pos_prevent_sales_below_cost) {
    const productIds = items.map((i) => i.productId);
    const { rows: costRows } = await query(
      `SELECT product_id, cost_price FROM products WHERE product_id = ANY($1::uuid[])`, [productIds]
    );
    const costMap = Object.fromEntries(costRows.map((r) => [r.product_id, parseFloat(r.cost_price ?? 0)]));
    for (const item of items) {
      const cost = costMap[item.productId] ?? 0;
      if (cost > 0 && parseFloat(item.lineTotal) / parseFloat(item.quantity) < cost) {
        throw AppError.badRequest('One or more items are priced below purchase cost. Sales below cost are not allowed.');
      }
    }
  }

  return transaction(async (client) => {
    // 1. Restore old inventory
    const { rows: oldItems } = await client.query(
      `SELECT product_id, quantity FROM sales_transaction_items WHERE transaction_id = $1`,
      [transactionId]
    );
    for (const oi of oldItems) {
      const { rows: inv } = await client.query(
        `SELECT quantity_available FROM product_branch_inventory
         WHERE product_id = $1 AND branch_id = $2 FOR UPDATE`,
        [oi.product_id, branchId]
      );
      const qtyBefore = inv.length ? parseFloat(inv[0].quantity_available) : 0;
      const qtyAfter  = qtyBefore + parseFloat(oi.quantity);
      await client.query(
        `UPDATE product_branch_inventory SET quantity_available = $1, last_updated = now()
         WHERE product_id = $2 AND branch_id = $3`,
        [qtyAfter, oi.product_id, branchId]
      );
      await recordMovement(client, {
        companyId, branchId, productId: oi.product_id,
        movementType: 'return', qtyIn: parseFloat(oi.quantity), qtyOut: 0,
        qtyBefore, qtyAfter,
        referenceType: 'SALE_EDIT', referenceId: transactionId,
        referenceNo: transactionNumber, notes: `Edit: ${editReason}`, userId,
      });

      if (costingMethod === 'fifo') {
        await returnFifoLayers(client, companyId, branchId, oi.product_id, parseFloat(oi.quantity));
      }
    }

    // 2. Reverse existing journal entry for this sale
    await jrn.postSaleEditReversal(client, companyId, {
      transaction_id: transactionId, transaction_number: transactionNumber,
      edited_by_user_id: userId,
    });

    // 3. Recompute totals from new items
    const subtotal      = items.reduce((s, i) => s + parseFloat(i.lineTotal), 0);
    const taxAmount     = items.reduce((s, i) => s + parseFloat(i.taxAmount  || 0), 0);
    const itemDiscounts = items.reduce((s, i) => s + parseFloat(i.discount   || 0), 0);
    const discountAmt   = itemDiscounts + parseFloat(orderDiscount);
    const totalAmount   = Math.max(0, subtotal - parseFloat(orderDiscount));
    const totalPaid     = payments.reduce((s, p) => s + parseFloat(p.amountApplied || 0), 0);
    const paymentStatus = totalPaid >= totalAmount ? 'paid' : 'partial';

    // 4. Update transaction header
    await client.query(`
      UPDATE sales_transactions
         SET customer_id    = $3,
             subtotal       = $4,
             tax_amount     = $5,
             discount_amount= $6,
             total_amount   = $7,
             payment_status = $8,
             notes          = $9,
             last_edited_by = $10,
             last_edited_at = now(),
             edit_reason    = $11,
             updated_at     = now()
       WHERE company_id = $1 AND transaction_id = $2
    `, [companyId, transactionId, customerId || null,
        subtotal, taxAmount, discountAmt, totalAmount, paymentStatus,
        notes || null, userId, editReason]);

    // 5. Replace items + deduct new inventory
    await client.query(`DELETE FROM sales_transaction_items WHERE transaction_id = $1`, [transactionId]);

    const cogsMap = costingMethod === 'fifo' ? {} : null;

    for (const item of items) {
      const { rows: stock } = await client.query(
        `SELECT quantity_available FROM product_branch_inventory
         WHERE product_id = $1 AND branch_id = $2 FOR UPDATE`,
        [item.productId, branchId]
      );
      if (!stock.length) throw AppError.unprocessable('Product not found in branch inventory');
      const available = parseFloat(stock[0].quantity_available);
      if (available < parseFloat(item.quantity)) {
        throw AppError.unprocessable(`Insufficient stock (available: ${available})`);
      }
      await client.query(`
        INSERT INTO sales_transaction_items
          (transaction_id, product_id, quantity, unit_price, discount, tax_amount, line_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [transactionId, item.productId, parseFloat(item.quantity),
          parseFloat(item.unitPrice), parseFloat(item.discount || 0),
          parseFloat(item.taxAmount || 0), parseFloat(item.lineTotal)]);

      await client.query(
        `UPDATE product_branch_inventory SET quantity_available = quantity_available - $1, last_updated = now()
         WHERE product_id = $2 AND branch_id = $3`,
        [parseFloat(item.quantity), item.productId, branchId]
      );
      await recordMovement(client, {
        companyId, branchId, productId: item.productId,
        movementType: 'sale', qtyIn: 0, qtyOut: parseFloat(item.quantity),
        qtyBefore: available, qtyAfter: available - parseFloat(item.quantity),
        referenceType: 'SALE_EDIT', referenceId: transactionId,
        referenceNo: transactionNumber, userId,
      });

      if (costingMethod === 'fifo') {
        const { totalCost } = await consumeFifoLayers(client, companyId, branchId, item.productId, parseFloat(item.quantity));
        cogsMap[item.productId] = (cogsMap[item.productId] || 0) + totalCost;
      }
    }

    // 6. Replace payments
    await client.query(`DELETE FROM transaction_payments WHERE transaction_id = $1`, [transactionId]);
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      await client.query(`
        INSERT INTO transaction_payments
          (transaction_id, payment_method_id, amount_tendered, amount_applied,
           change_given, reference_number, sequence_no)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [transactionId, p.paymentMethodId,
          parseFloat(p.amountTendered || p.amountApplied),
          parseFloat(p.amountApplied),
          parseFloat(p.changeGiven || 0),
          p.referenceNumber || null, i + 1]);
    }

    // 7. Re-post journal with new figures
    await jrn.postSaleEntry(client, companyId, {
      transaction_id:     transactionId,
      transaction_number: transactionNumber,
      transaction_date:   transactionDate,
      total_amount:       totalAmount,
      tax_amount:         taxAmount,
      cashier_user_id:    cashierUserId,
      customer_id:        customerId || null,
    },
    items.map((i) => ({
      productId:  i.productId,
      product_id: i.productId,
      quantity:   parseFloat(i.quantity),
      lineTotal:  parseFloat(i.lineTotal),
    })),
    payments.map((p) => ({
      paymentMethodId:   p.paymentMethodId,
      payment_method_id: p.paymentMethodId,
      amountApplied:     parseFloat(p.amountApplied || 0),
      amount_applied:    parseFloat(p.amountApplied || 0),
    })),
    cogsMap);

    return { transaction_id: transactionId, transaction_number: transactionNumber };
  });
}

module.exports = { createTransaction, listTransactions, getTransaction, voidTransaction, editTransaction };
