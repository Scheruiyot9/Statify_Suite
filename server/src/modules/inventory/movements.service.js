const { query } = require('../../config/database');
const QueryBuilder = require('../../shared/qb');
const { isCompanyWide } = require('../../shared/roles');

/**
 * Record a single inventory movement.
 * Must be called inside a DB transaction via the client param.
 */
async function recordMovement(client, {
  companyId, branchId, productId,
  movementType,            // 'sale' | 'return' | 'grn' | 'adjustment' | 'opening_stock'
  qtyIn  = 0,
  qtyOut = 0,
  qtyBefore,
  qtyAfter,
  referenceType = null,   // 'SALE' | 'GRN' | 'RETURN' | 'ADJUSTMENT'
  referenceId   = null,
  referenceNo   = null,
  notes         = null,
  userId        = null,
}) {
  await client.query(`
    INSERT INTO inventory_movements
      (company_id, branch_id, product_id, movement_type,
       qty_in, qty_out, qty_before, qty_after,
       reference_type, reference_id, reference_no, notes, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `, [
    companyId, branchId, productId, movementType,
    parseFloat(qtyIn) || 0, parseFloat(qtyOut) || 0,
    parseFloat(qtyBefore), parseFloat(qtyAfter),
    referenceType, referenceId, referenceNo, notes, userId,
  ]);
}

/**
 * List movements with filters — used by the Stock Ledger UI.
 */
async function listMovements(companyId, role, branchIds, filters = {}) {
  const {
    branchId, productId, movementType,
    fromDate, toDate,
    page = 1, limit = 50,
  } = filters;

  const isWide = isCompanyWide(role);
  const qb = new QueryBuilder([companyId]);
  const conds = ['im.company_id = $1'];

  if (!isWide) {
    const ids = branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000'];
    conds.push(`im.branch_id = ANY($${qb.add(ids)})`);
  } else if (branchId) {
    conds.push(`im.branch_id = $${qb.add(branchId)}`);
  }

  if (productId)     conds.push(`im.product_id = $${qb.add(productId)}`);
  if (movementType)  conds.push(`im.movement_type = $${qb.add(movementType)}`);
  if (fromDate)      conds.push(`im.created_at >= $${qb.add(fromDate)}`);
  if (toDate)        conds.push(`im.created_at < $${qb.add(toDate + ' 23:59:59')}`);

  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const limIdx = qb.add(lm);
  const offIdx = qb.add((pg - 1) * lm);

  const { rows } = await query(`
    SELECT
      im.movement_id,
      im.movement_type,
      im.qty_in::numeric,
      im.qty_out::numeric,
      im.qty_before::numeric,
      im.qty_after::numeric,
      im.reference_type,
      im.reference_no,
      im.reference_id,
      im.notes,
      im.created_at,
      p.product_name, p.sku, p.unit_of_measure, im.product_id,
      b.branch_name, im.branch_id,
      u.first_name || ' ' || u.last_name AS created_by_name,
      COUNT(*) OVER() AS total_count
    FROM inventory_movements im
    JOIN products p  ON p.product_id = im.product_id
    JOIN branches b  ON b.branch_id  = im.branch_id
    LEFT JOIN users u ON u.user_id   = im.created_by
    WHERE ${conds.join(' AND ')}
    ORDER BY im.created_at DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    movements: rows.map(({ total_count, ...r }) => ({
      ...r,
      qty_in:     parseFloat(r.qty_in),
      qty_out:    parseFloat(r.qty_out),
      qty_before: parseFloat(r.qty_before),
      qty_after:  parseFloat(r.qty_after),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

module.exports = { recordMovement, listMovements };
