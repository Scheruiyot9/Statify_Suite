const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const { isCompanyWide } = require('../../shared/roles');
const { sendMail } = require('../../shared/mailer');
const QueryBuilder = require('../../shared/qb');

async function listInventory(companyId, role, branchIds, filters = {}) {
  const { branchId, search, lowStock, categoryId, page = 1, limit = 50 } = filters;
  const isWide = isCompanyWide(role);

  const qb = new QueryBuilder([companyId]);
  const conditions = ['p.company_id = $1', 'p.is_active = TRUE', 'b.is_active = TRUE'];

  if (!isWide) {
    const ids = branchIds?.length ? branchIds : ['00000000-0000-0000-0000-000000000000'];
    conditions.push(`pbi.branch_id = ANY($${qb.add(ids)})`);
  } else if (branchId) {
    conditions.push(`pbi.branch_id = $${qb.add(branchId)}`);
  }

  if (search) {
    const p = qb.add(`%${search}%`);
    conditions.push(`(p.product_name ILIKE $${p} OR p.sku ILIKE $${p})`);
  }
  if (categoryId) {
    conditions.push(`p.category_id = $${qb.add(categoryId)}`);
  }
  if (lowStock === 'true' || lowStock === true) {
    conditions.push(`pbi.reorder_level > 0 AND pbi.quantity_available <= pbi.reorder_level`);
  }

  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const limIdx = qb.add(lm);
  const offIdx = qb.add((pg - 1) * lm);

  const { rows } = await query(`
    SELECT
      p.product_id, p.product_name, p.sku, p.unit_of_measure,
      pc.category_name, pc.category_id,
      pbi.branch_id, b.branch_name,
      pbi.quantity_available::numeric,
      COALESCE(pbi.quantity_reserved, 0)::numeric   AS quantity_reserved,
      COALESCE(pbi.reorder_level,    0)::integer    AS reorder_level,
      pbi.last_updated,
      COALESCE(pbp.selling_price, p.base_price)::numeric AS selling_price,
      p.cost_price::numeric,
      COUNT(*) OVER() AS total_count
    FROM product_branch_inventory pbi
    JOIN products p  ON p.product_id  = pbi.product_id
    JOIN branches b  ON b.branch_id   = pbi.branch_id AND b.company_id = $1
    LEFT JOIN categories pc   ON pc.category_id  = p.category_id
    LEFT JOIN product_branch_pricing pbp ON pbp.product_id = p.product_id AND pbp.branch_id = pbi.branch_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.product_name, b.branch_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;

  return {
    inventory: rows.map((r) => ({
      product_id:         r.product_id,
      product_name:       r.product_name,
      sku:                r.sku,
      unit_of_measure:    r.unit_of_measure,
      category_id:        r.category_id,
      category_name:      r.category_name,
      branch_id:          r.branch_id,
      branch_name:        r.branch_name,
      quantity_available: parseFloat(r.quantity_available),
      quantity_reserved:  parseFloat(r.quantity_reserved),
      reorder_level:      parseInt(r.reorder_level),
      last_updated:       r.last_updated,
      selling_price:      parseFloat(r.selling_price),
      cost_price:         r.cost_price ? parseFloat(r.cost_price) : null,
      is_low_stock:
        parseInt(r.reorder_level) > 0 &&
        parseFloat(r.quantity_available) <= parseInt(r.reorder_level),
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

async function adjustStock(companyId, userId, data) {
  const { product_id, branch_id, adjustment, notes } = data;
  if (!product_id || !branch_id) throw AppError.badRequest('product_id and branch_id are required');
  const qty = parseFloat(adjustment);
  if (!qty || qty === 0) throw AppError.badRequest('Adjustment quantity cannot be zero');

  return transaction(async (client) => {
    const { rows } = await client.query(`
      SELECT pbi.quantity_available, pbi.reorder_level,
             p.product_name, p.sku,
             b.branch_name,
             c.contact_email, c.company_name
      FROM product_branch_inventory pbi
      JOIN products  p ON p.product_id = pbi.product_id AND p.company_id = $1
      JOIN branches  b ON b.branch_id  = $3
      JOIN companies c ON c.company_id = $1
      WHERE pbi.product_id = $2 AND pbi.branch_id = $3
      FOR UPDATE
    `, [companyId, product_id, branch_id]);

    if (!rows.length) throw AppError.notFound('Inventory record');

    const { product_name, sku, branch_name, contact_email, company_name } = rows[0];
    const reorderLevel = parseInt(rows[0].reorder_level) || 0;
    const current = parseFloat(rows[0].quantity_available);
    const newQty  = current + qty;
    if (newQty < 0) throw AppError.unprocessable(`Cannot reduce below zero. Current stock: ${current}`);

    await client.query(`
      UPDATE product_branch_inventory
      SET quantity_available = $1, last_updated = now()
      WHERE product_id = $2 AND branch_id = $3
    `, [newQty, product_id, branch_id]);

    // Fire low-stock alert when stock crosses (or stays below) the reorder threshold
    if (reorderLevel > 0 && newQty <= reorderLevel && contact_email) {
      sendMail({
        to:      contact_email,
        subject: `Low Stock Alert — ${product_name} at ${branch_name}`,
        html: `
          <p>Hi ${company_name} team,</p>
          <p>The following product has reached its reorder threshold:</p>
          <table style="border-collapse:collapse;font-family:sans-serif">
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Product</td><td>${product_name}${sku ? ` (${sku})` : ''}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Branch</td><td>${branch_name}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Current Stock</td><td>${newQty}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Reorder Level</td><td>${reorderLevel}</td></tr>
          </table>
          <p>Please replenish stock at your earliest convenience.</p>
        `,
        text: `Low Stock Alert: ${product_name} at ${branch_name} — current stock ${newQty} is at or below reorder level ${reorderLevel}.`,
      }).catch(() => {}); // non-blocking; don't fail the adjustment if mail errors
    }

    return { product_name, quantity_before: current, quantity_after: newQty, adjustment: qty };
  });
}

async function adjustStockBulk(companyId, userId, items) {
  if (!Array.isArray(items) || !items.length) throw AppError.badRequest('items array is required');

  return transaction(async (client) => {
    const results = [];

    for (const item of items) {
      const { product_id, branch_id, adjustment, notes } = item;
      if (!product_id || !branch_id) throw AppError.badRequest('Each item requires product_id and branch_id');
      const qty = parseFloat(adjustment);
      if (!qty || qty === 0) throw AppError.badRequest('Adjustment quantity cannot be zero');

      const { rows } = await client.query(`
        SELECT pbi.quantity_available, pbi.reorder_level,
               p.product_name, p.sku,
               b.branch_name,
               c.contact_email, c.company_name
        FROM product_branch_inventory pbi
        JOIN products  p ON p.product_id = pbi.product_id AND p.company_id = $1
        JOIN branches  b ON b.branch_id  = $3
        JOIN companies c ON c.company_id = $1
        WHERE pbi.product_id = $2 AND pbi.branch_id = $3
        FOR UPDATE
      `, [companyId, product_id, branch_id]);

      if (!rows.length) throw AppError.notFound(`Inventory record for product ${product_id}`);

      const { product_name, sku, branch_name, contact_email, company_name } = rows[0];
      const reorderLevel = parseInt(rows[0].reorder_level) || 0;
      const current = parseFloat(rows[0].quantity_available);
      const newQty  = current + qty;
      if (newQty < 0) throw AppError.unprocessable(`Cannot reduce ${product_name} below zero. Current stock: ${current}`);

      await client.query(`
        UPDATE product_branch_inventory
        SET quantity_available = $1, last_updated = now()
        WHERE product_id = $2 AND branch_id = $3
      `, [newQty, product_id, branch_id]);

      if (reorderLevel > 0 && newQty <= reorderLevel && contact_email) {
        sendMail({
          to:      contact_email,
          subject: `Low Stock Alert — ${product_name} at ${branch_name}`,
          html: `<p>Hi ${company_name} team,</p><p>${product_name}${sku ? ` (${sku})` : ''} at ${branch_name} is at ${newQty} (reorder level: ${reorderLevel}).</p>`,
          text: `Low Stock Alert: ${product_name} at ${branch_name} — stock ${newQty} at or below reorder level ${reorderLevel}.`,
        }).catch(() => {});
      }

      results.push({ product_name, quantity_before: current, quantity_after: newQty, adjustment: qty, notes });
    }

    return results;
  });
}

async function updateReorderLevel(companyId, productId, branchId, data) {
  const { reorder_level } = data;
  const { rows } = await query(`
    UPDATE product_branch_inventory
    SET reorder_level = COALESCE($3::integer, reorder_level),
        last_updated  = now()
    WHERE product_id = $1 AND branch_id = $2
    RETURNING *
  `, [productId, branchId, reorder_level ?? null]);
  if (!rows.length) throw AppError.notFound('Inventory record');
  return rows[0];
}

module.exports = { listInventory, adjustStock, adjustStockBulk, updateReorderLevel };
