const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const jrn = require('../journal/journal.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTotals(items) {
  const subtotal   = items.reduce((s, i) => s + parseFloat(i.line_total), 0);
  const taxAmount  = items.reduce((s, i) => {
    const lt = parseFloat(i.line_total);
    const tr = parseFloat(i.tax_rate || 0) / 100;
    return s + lt * tr / (1 + tr); // VAT extracted from VAT-inclusive price
  }, 0);
  return { subtotal: +subtotal.toFixed(2), taxAmount: +taxAmount.toFixed(2), total: +subtotal.toFixed(2) };
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

async function listPOs(companyId, { status, supplierId, page = 1, limit = 25 } = {}) {
  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const conds = ['po.company_id = $1'];
  const vals  = [companyId];

  if (status)     { vals.push(status);     conds.push(`po.status = $${vals.length}`); }
  if (supplierId) { vals.push(supplierId); conds.push(`po.supplier_id = $${vals.length}`); }

  vals.push(lm, (pg - 1) * lm);
  const { rows } = await query(`
    SELECT po.po_id, po.po_number, po.order_date, po.expected_date, po.status,
           po.subtotal, po.tax_amount, po.total_amount, po.notes,
           po.created_at, po.approved_at,
           s.supplier_name, b.branch_name,
           u.first_name || ' ' || u.last_name AS created_by,
           a.first_name || ' ' || a.last_name AS approved_by,
           COUNT(*) OVER() AS total_count
    FROM purchase_orders po
    JOIN suppliers s ON s.supplier_id = po.supplier_id
    JOIN branches  b ON b.branch_id   = po.branch_id
    LEFT JOIN users u ON u.user_id = po.created_by_user_id
    LEFT JOIN users a ON a.user_id = po.approved_by_user_id
    WHERE ${conds.join(' AND ')}
    ORDER BY po.created_at DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return { orders: rows.map(({ total_count, ...r }) => r), total, page: pg, limit: lm, pages: Math.ceil(total / lm) };
}

async function getPO(companyId, poId) {
  const { rows: [po] } = await query(`
    SELECT po.*,
           s.supplier_name, s.email AS supplier_email, s.phone AS supplier_phone,
           s.payment_terms, s.address AS supplier_address,
           b.branch_name,
           u.first_name || ' ' || u.last_name AS created_by,
           a.first_name || ' ' || a.last_name AS approved_by
    FROM purchase_orders po
    JOIN suppliers s ON s.supplier_id = po.supplier_id
    JOIN branches  b ON b.branch_id   = po.branch_id
    LEFT JOIN users u ON u.user_id = po.created_by_user_id
    LEFT JOIN users a ON a.user_id = po.approved_by_user_id
    WHERE po.po_id = $1 AND po.company_id = $2
  `, [poId, companyId]);
  if (!po) throw AppError.notFound('Purchase Order');

  const { rows: items } = await query(`
    SELECT poi.*, p.product_name, p.sku, p.unit_of_measure
    FROM purchase_order_items poi
    JOIN products p ON p.product_id = poi.product_id
    WHERE poi.po_id = $1
    ORDER BY poi.created_at
  `, [poId]);

  const { rows: grns } = await query(`
    SELECT grn.grn_id, grn.grn_number, grn.received_date, grn.status,
           grn.total_amount, grn.posted_at
    FROM grns grn
    WHERE grn.po_id = $1
    ORDER BY grn.created_at DESC
  `, [poId]);

  return { ...po, items, grns };
}

async function createPO(companyId, userId, data) {
  const { branch_id, supplier_id, order_date, expected_date, notes, items } = data;
  if (!branch_id)   throw AppError.badRequest('branch_id is required');
  if (!supplier_id) throw AppError.badRequest('supplier_id is required');
  if (!items?.length) throw AppError.badRequest('At least one item is required');

  return transaction(async (client) => {
    const { rows: [{ po_counter }] } = await client.query(
      `UPDATE companies SET po_counter = po_counter + 1 WHERE company_id = $1 RETURNING po_counter`,
      [companyId]
    );
    const poNumber = `PO-${new Date().getFullYear()}-${String(po_counter).padStart(6, '0')}`;
    const { subtotal, taxAmount, total } = calcTotals(items);

    const { rows: [po] } = await client.query(`
      INSERT INTO purchase_orders
        (company_id, branch_id, supplier_id, po_number, order_date, expected_date,
         status, subtotal, tax_amount, total_amount, notes, created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11)
      RETURNING *
    `, [companyId, branch_id, supplier_id, poNumber,
        order_date || new Date().toISOString().slice(0, 10),
        expected_date || null, subtotal, taxAmount, total, notes || null, userId]);

    for (const item of items) {
      const lineTotal = +(parseFloat(item.quantity_ordered) * parseFloat(item.unit_cost)).toFixed(2);
      await client.query(`
        INSERT INTO purchase_order_items
          (po_id, product_id, description, quantity_ordered, unit_cost, tax_rate, line_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [po.po_id, item.product_id, item.description || null,
          parseFloat(item.quantity_ordered), parseFloat(item.unit_cost),
          parseFloat(item.tax_rate || 0), lineTotal]);
    }
    return { po_id: po.po_id, po_number: po.po_number, status: po.status };
  });
}

async function updatePO(companyId, poId, data) {
  const { rows: [existing] } = await query(
    `SELECT status FROM purchase_orders WHERE po_id = $1 AND company_id = $2`, [poId, companyId]
  );
  if (!existing) throw AppError.notFound('Purchase Order');
  if (existing.status !== 'draft') throw AppError.conflict('Only draft POs can be edited');

  const { branch_id, supplier_id, order_date, expected_date, notes, items } = data;

  return transaction(async (client) => {
    if (items?.length) {
      const { subtotal, taxAmount, total } = calcTotals(items);
      await client.query(
        `UPDATE purchase_orders SET branch_id=$2, supplier_id=$3, order_date=$4, expected_date=$5,
         notes=$6, subtotal=$7, tax_amount=$8, total_amount=$9, updated_at=now()
         WHERE po_id=$1`,
        [poId, branch_id, supplier_id,
         order_date || new Date().toISOString().slice(0, 10),
         expected_date || null, notes || null, subtotal, taxAmount, total]
      );
      await client.query(`DELETE FROM purchase_order_items WHERE po_id = $1`, [poId]);
      for (const item of items) {
        const lineTotal = +(parseFloat(item.quantity_ordered) * parseFloat(item.unit_cost)).toFixed(2);
        await client.query(`
          INSERT INTO purchase_order_items
            (po_id, product_id, description, quantity_ordered, unit_cost, tax_rate, line_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [poId, item.product_id, item.description || null,
            parseFloat(item.quantity_ordered), parseFloat(item.unit_cost),
            parseFloat(item.tax_rate || 0), lineTotal]);
      }
    } else {
      await client.query(
        `UPDATE purchase_orders SET order_date=$2, expected_date=$3, notes=$4, updated_at=now() WHERE po_id=$1`,
        [poId, order_date || new Date().toISOString().slice(0, 10), expected_date || null, notes || null]
      );
    }
    return getPO(companyId, poId);
  });
}

async function submitPO(companyId, poId) {
  const { rows } = await query(`
    UPDATE purchase_orders SET status='pending_approval', updated_at=now()
    WHERE po_id=$1 AND company_id=$2 AND status='draft'
    RETURNING po_id, po_number, status
  `, [poId, companyId]);
  if (!rows.length) throw AppError.conflict('PO must be in draft status to submit');
  return rows[0];
}

async function approvePO(companyId, poId, userId) {
  const { rows } = await query(`
    UPDATE purchase_orders
    SET status='approved', approved_by_user_id=$3, approved_at=now(), updated_at=now()
    WHERE po_id=$1 AND company_id=$2 AND status='pending_approval'
    RETURNING po_id, po_number, status
  `, [poId, companyId, userId]);
  if (!rows.length) throw AppError.conflict('PO must be pending approval to approve');
  return rows[0];
}

async function cancelPO(companyId, poId) {
  const { rows } = await query(`
    UPDATE purchase_orders SET status='cancelled', updated_at=now()
    WHERE po_id=$1 AND company_id=$2 AND status IN ('draft','pending_approval','approved')
    RETURNING po_id, po_number, status
  `, [poId, companyId]);
  if (!rows.length) throw AppError.conflict('PO cannot be cancelled in its current status');
  return rows[0];
}

// ── GRNs ─────────────────────────────────────────────────────────────────────

async function listGRNs(companyId, { status, supplierId, page = 1, limit = 25 } = {}) {
  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const conds = ['g.company_id = $1'];
  const vals  = [companyId];

  if (status)     { vals.push(status);     conds.push(`g.status = $${vals.length}`); }
  if (supplierId) { vals.push(supplierId); conds.push(`g.supplier_id = $${vals.length}`); }

  vals.push(lm, (pg - 1) * lm);
  const { rows } = await query(`
    SELECT g.grn_id, g.grn_number, g.received_date, g.status,
           g.subtotal, g.total_amount, g.posted_at, g.notes,
           po.po_number, s.supplier_name, b.branch_name,
           u.first_name || ' ' || u.last_name AS received_by,
           COUNT(*) OVER() AS total_count
    FROM grns g
    JOIN purchase_orders po ON po.po_id = g.po_id
    JOIN suppliers s ON s.supplier_id = g.supplier_id
    JOIN branches  b ON b.branch_id   = g.branch_id
    LEFT JOIN users u ON u.user_id = g.received_by_user_id
    WHERE ${conds.join(' AND ')}
    ORDER BY g.created_at DESC
    LIMIT $${vals.length - 1} OFFSET $${vals.length}
  `, vals);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return { grns: rows.map(({ total_count, ...r }) => r), total, page: pg, limit: lm, pages: Math.ceil(total / lm) };
}

async function getGRN(companyId, grnId) {
  const { rows: [grn] } = await query(`
    SELECT g.*, po.po_number, s.supplier_name, b.branch_name,
           u.first_name || ' ' || u.last_name AS received_by
    FROM grns g
    JOIN purchase_orders po ON po.po_id = g.po_id
    JOIN suppliers s ON s.supplier_id = g.supplier_id
    JOIN branches  b ON b.branch_id   = g.branch_id
    LEFT JOIN users u ON u.user_id = g.received_by_user_id
    WHERE g.grn_id = $1 AND g.company_id = $2
  `, [grnId, companyId]);
  if (!grn) throw AppError.notFound('GRN');

  const { rows: items } = await query(`
    SELECT gi.*, p.product_name, p.sku, p.unit_of_measure,
           poi.quantity_ordered, poi.quantity_received AS poi_received
    FROM grn_items gi
    JOIN products p ON p.product_id = gi.product_id
    JOIN purchase_order_items poi ON poi.poi_id = gi.poi_id
    WHERE gi.grn_id = $1
  `, [grnId]);

  return { ...grn, items };
}

async function createGRN(companyId, userId, data) {
  const { po_id, received_date, notes, items } = data;
  if (!po_id) throw AppError.badRequest('po_id is required');
  if (!items?.length) throw AppError.badRequest('At least one item is required');

  const { rows: [po] } = await query(
    `SELECT po_id, branch_id, supplier_id, status FROM purchase_orders WHERE po_id=$1 AND company_id=$2`,
    [po_id, companyId]
  );
  if (!po) throw AppError.notFound('Purchase Order');
  if (!['approved','partially_received'].includes(po.status))
    throw AppError.conflict('PO must be approved before receiving goods');

  // Validate items against PO items
  for (const item of items) {
    const { rows: [poi] } = await query(
      `SELECT poi_id, quantity_ordered, quantity_received FROM purchase_order_items WHERE poi_id=$1 AND po_id=$2`,
      [item.poi_id, po_id]
    );
    if (!poi) throw AppError.badRequest(`PO item ${item.poi_id} not found`);
    const remaining = parseFloat(poi.quantity_ordered) - parseFloat(poi.quantity_received);
    if (parseFloat(item.quantity_received) > remaining + 0.001)
      throw AppError.unprocessable(`Quantity received exceeds remaining on order for item`);
  }

  return transaction(async (client) => {
    const { rows: [{ grn_counter }] } = await client.query(
      `UPDATE companies SET grn_counter = grn_counter + 1 WHERE company_id = $1 RETURNING grn_counter`,
      [companyId]
    );
    const grnNumber = `GRN-${new Date().getFullYear()}-${String(grn_counter).padStart(6, '0')}`;

    const subtotal = items.reduce((s, i) => s + parseFloat(i.quantity_received) * parseFloat(i.unit_cost), 0);

    const { rows: [grn] } = await client.query(`
      INSERT INTO grns
        (company_id, branch_id, supplier_id, po_id, grn_number, received_date,
         status, subtotal, total_amount, notes, received_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$7,$8,$9)
      RETURNING *
    `, [companyId, po.branch_id, po.supplier_id, po_id, grnNumber,
        received_date || new Date().toISOString().slice(0, 10),
        +subtotal.toFixed(2), notes || null, userId]);

    for (const item of items) {
      const lineTotal = +(parseFloat(item.quantity_received) * parseFloat(item.unit_cost)).toFixed(2);
      await client.query(`
        INSERT INTO grn_items (grn_id, poi_id, product_id, quantity_received, unit_cost, line_total)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [grn.grn_id, item.poi_id, item.product_id,
          parseFloat(item.quantity_received), parseFloat(item.unit_cost), lineTotal]);
    }

    return { grn_id: grn.grn_id, grn_number: grn.grn_number };
  });
}

async function postGRN(companyId, grnId) {
  const { rows: [grn] } = await query(
    `SELECT * FROM grns WHERE grn_id=$1 AND company_id=$2`, [grnId, companyId]
  );
  if (!grn) throw AppError.notFound('GRN');
  if (grn.status === 'posted') throw AppError.conflict('GRN is already posted');

  const { rows: items } = await query(
    `SELECT * FROM grn_items WHERE grn_id = $1`, [grnId]
  );

  return transaction(async (client) => {
    // Update inventory — upsert into product_branch_inventory
    for (const item of items) {
      await client.query(`
        INSERT INTO product_branch_inventory (product_id, branch_id, quantity_available, reorder_level, last_updated)
        VALUES ($1, $2, $3, 0, now())
        ON CONFLICT (product_id, branch_id) DO UPDATE
          SET quantity_available = product_branch_inventory.quantity_available + $3,
              last_updated = now()
      `, [item.product_id, grn.branch_id, parseFloat(item.quantity_received)]);

      // Update PO item received qty
      await client.query(`
        UPDATE purchase_order_items
        SET quantity_received = quantity_received + $2
        WHERE poi_id = $1
      `, [item.poi_id, parseFloat(item.quantity_received)]);
    }

    // Determine PO status after this GRN
    const { rows: poItems } = await client.query(
      `SELECT quantity_ordered, quantity_received FROM purchase_order_items WHERE po_id = $1`,
      [grn.po_id]
    );
    const allReceived = poItems.every(
      (i) => parseFloat(i.quantity_received) >= parseFloat(i.quantity_ordered) - 0.001
    );
    const newPoStatus = allReceived ? 'received' : 'partially_received';
    await client.query(
      `UPDATE purchase_orders SET status=$2, updated_at=now() WHERE po_id=$1`,
      [grn.po_id, newPoStatus]
    );

    // Update supplier AP balance
    await client.query(
      `UPDATE suppliers SET current_balance = current_balance + $2, updated_at=now() WHERE supplier_id=$1`,
      [grn.supplier_id, parseFloat(grn.total_amount)]
    );

    // Mark GRN as posted
    const { rows: [posted] } = await client.query(`
      UPDATE grns SET status='posted', posted_at=now(), updated_at=now()
      WHERE grn_id=$1 RETURNING grn_id, grn_number, status
    `, [grnId]);

    // Post double-entry journal for this GRN
    await jrn.postGrnEntry(client, companyId, { ...grn, ...posted });

    return posted;
  });
}

async function deleteGRN(companyId, grnId) {
  const { rows: [grn] } = await query(
    `SELECT * FROM grns WHERE grn_id=$1 AND company_id=$2`, [grnId, companyId]
  );
  if (!grn) throw AppError.notFound('GRN');
  if (grn.status === 'posted') throw AppError.conflict('Cannot delete a posted GRN. Only draft GRNs can be deleted.');

  await query(`DELETE FROM grn_items WHERE grn_id=$1`, [grnId]);
  await query(`DELETE FROM grns WHERE grn_id=$1`, [grnId]);
  return { deleted: true };
}

module.exports = {
  listPOs, getPO, createPO, updatePO, submitPO, approvePO, cancelPO,
  listGRNs, getGRN, createGRN, postGRN, deleteGRN,
};
