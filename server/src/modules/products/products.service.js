const { query, transaction } = require('../../config/database');
const AppError = require('../../shared/AppError');
const QueryBuilder = require('../../shared/qb');

const PRODUCT_SORT = {
  name:     'p.product_name',
  sku:      'p.sku',
  price:    'branch_price',
  cost:     'p.cost_price',
  category: 'pc.category_name',
  stock:    'quantity_available',
};

async function listProducts(companyId, { branchId, search, categoryId, isActive, page = 1, limit = 60, sortBy, sortDir } = {}) {
  const qb = new QueryBuilder([companyId]);
  // isActive: undefined/'' = all, 'true' = active only, 'false' = inactive only
  const activeClause = isActive === 'true' ? 'p.is_active = TRUE'
                     : isActive === 'false' ? 'p.is_active = FALSE'
                     : 'TRUE';
  const conditions = ['p.company_id = $1', activeClause, 'p.deleted_at IS NULL'];
  let branchJoins = '';
  // No specific branch selected — reorder level is set uniformly across branches on save,
  // so surface whichever value is currently on record (any active branch should match).
  let branchSelect = `p.base_price::numeric AS branch_price, 0::numeric AS quantity_available,
      COALESCE((SELECT MAX(reorder_level) FROM product_branch_inventory WHERE product_id = p.product_id), 0)::integer AS reorder_level`;

  if (branchId) {
    const bIdx = qb.add(branchId);
    branchJoins = `
      LEFT JOIN product_branch_pricing pbp ON pbp.product_id = p.product_id AND pbp.branch_id = $${bIdx}
      LEFT JOIN product_branch_inventory pbi ON pbi.product_id = p.product_id AND pbi.branch_id = $${bIdx}`;
    branchSelect = `COALESCE(pbp.selling_price, p.base_price)::numeric AS branch_price,
      COALESCE(pbi.quantity_available, 0)::numeric AS quantity_available,
      pbi.reorder_level::integer AS reorder_level`;
  }

  if (search) {
    const p = qb.add(`%${search}%`);
    conditions.push(`(p.product_name ILIKE $${p} OR p.sku ILIKE $${p} OR p.barcode ILIKE $${p})`);
  }

  if (categoryId) {
    conditions.push(`p.category_id = $${qb.add(categoryId)}`);
  }

  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const limIdx = qb.add(lm);
  const offIdx = qb.add((pg - 1) * lm);

  const { rows } = await query(`
    SELECT
      p.product_id, p.product_name, p.sku, p.barcode, p.image_url, p.description,
      p.base_price::numeric, p.cost_price::numeric, p.unit_of_measure,
      p.category_id, p.is_active, p.track_inventory, p.is_service_item, pc.category_name,
      p.tax_template_id,
      tt.template_name AS tax_template_name,
      tt.tax_rate::numeric AS tax_rate,
      tt.is_inclusive AS tax_inclusive,
      ${branchSelect},
      COUNT(*) OVER() AS total_count
    FROM products p
    LEFT JOIN categories pc ON pc.category_id = p.category_id
    LEFT JOIN tax_templates tt ON tt.tax_template_id = p.tax_template_id
    ${branchJoins}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${PRODUCT_SORT[sortBy] || 'p.product_name'} ${sortDir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST,
             p.product_name ASC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;

  return {
    products: rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      sku: r.sku,
      barcode: r.barcode,
      image_url: r.image_url || null,
      description: r.description || null,
      base_price: parseFloat(r.base_price),
      cost_price: r.cost_price ? parseFloat(r.cost_price) : null,
      unit_of_measure: r.unit_of_measure,
      category_id: r.category_id,
      category_name: r.category_name,
      is_active: r.is_active,
      track_inventory: r.track_inventory,
      is_service_item: r.is_service_item,
      branch_price: parseFloat(r.branch_price),
      quantity_available: parseFloat(r.quantity_available),
      reorder_level: r.reorder_level ? parseInt(r.reorder_level) : 0,
      tax_template_id:   r.tax_template_id ?? null,
      tax_template_name: r.tax_template_name ?? null,
      tax_rate:          r.tax_rate != null ? parseFloat(r.tax_rate) : null,
      tax_inclusive:     r.tax_inclusive ?? null,
    })),
    total,
    page: pg,
    limit: lm,
    pages: Math.ceil(total / lm),
  };
}

async function getProductById(companyId, productId, branchId) {
  const params = [companyId, productId];
  let branchJoins = '';
  // No specific branch selected — reorder level is set uniformly across branches on save,
  // so surface whichever value is currently on record (any active branch should match).
  let branchSelect = `p.base_price::numeric AS branch_price, 0::numeric AS quantity_available,
    COALESCE((SELECT MAX(reorder_level) FROM product_branch_inventory WHERE product_id = p.product_id), 0)::integer AS reorder_level`;

  if (branchId) {
    params.push(branchId);
    branchJoins = `
      LEFT JOIN product_branch_pricing pbp ON pbp.product_id = p.product_id AND pbp.branch_id = $3
      LEFT JOIN product_branch_inventory pbi ON pbi.product_id = p.product_id AND pbi.branch_id = $3`;
    branchSelect = `COALESCE(pbp.selling_price, p.base_price)::numeric AS branch_price,
      COALESCE(pbi.quantity_available, 0)::numeric AS quantity_available,
      COALESCE(pbi.reorder_level, 0)::integer AS reorder_level`;
  }

  const { rows } = await query(`
    SELECT p.product_id, p.product_name, p.sku, p.barcode, p.image_url, p.description,
      p.base_price::numeric, p.cost_price::numeric, p.unit_of_measure,
      p.category_id, p.is_active, p.track_inventory, p.is_service_item, pc.category_name,
      p.tax_template_id,
      tt.template_name AS tax_template_name,
      tt.tax_rate::numeric AS tax_rate,
      tt.is_inclusive AS tax_inclusive,
      ${branchSelect}
    FROM products p
    LEFT JOIN categories pc ON pc.category_id = p.category_id
    LEFT JOIN tax_templates tt ON tt.tax_template_id = p.tax_template_id
    ${branchJoins}
    WHERE p.company_id = $1 AND p.product_id = $2 AND p.deleted_at IS NULL
  `, params);

  if (!rows.length) throw AppError.notFound('Product');
  const r = rows[0];
  return {
    ...r,
    base_price: parseFloat(r.base_price),
    cost_price: r.cost_price ? parseFloat(r.cost_price) : null,
    branch_price: parseFloat(r.branch_price),
    quantity_available: parseFloat(r.quantity_available),
    reorder_level: r.reorder_level != null ? parseInt(r.reorder_level) : 0,
  };
}

async function listCategories(companyId) {
  const { rows } = await query(
    `SELECT category_id, category_name, parent_category_id
     FROM categories
     WHERE company_id = $1 AND is_active = TRUE
     ORDER BY category_name`,
    [companyId]
  );
  return rows;
}

async function createProduct(companyId, data) {
  const {
    product_name, sku, barcode, description, category_id,
    base_price, cost_price, unit_of_measure = 'Unit',
    image_url, reorder_level = 0, initial_stock = 0, tax_template_id,
  } = data;

  return transaction(async (client) => {
    const dup = await client.query(
      'SELECT 1 FROM products WHERE company_id = $1 AND sku = $2',
      [companyId, sku]
    );
    if (dup.rows.length) throw AppError.conflict('A product with this SKU already exists');

    const { rows } = await client.query(`
      INSERT INTO products (
        company_id, product_name, sku, barcode, description,
        category_id, base_price, cost_price, unit_of_measure, image_url, tax_template_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [companyId, product_name, sku, barcode || null, description || null,
      category_id || null, base_price, cost_price || null, unit_of_measure, image_url || null,
      tax_template_id || null]);

    const product = rows[0];

    const { rows: branches } = await client.query(
      'SELECT branch_id FROM branches WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL',
      [companyId]
    );

    for (const b of branches) {
      await client.query(`
        INSERT INTO product_branch_inventory (product_id, branch_id, quantity_available, reorder_level)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (product_id, branch_id) DO NOTHING
      `, [product.product_id, b.branch_id, parseFloat(initial_stock) || 0, parseFloat(reorder_level) || 0]);
    }

    return product;
  });
}

async function updateProduct(companyId, productId, data) {
  const {
    product_name, barcode, description, category_id,
    base_price, cost_price, unit_of_measure, is_active, image_url, tax_template_id,
    reorder_level,
  } = data;

  // Allow explicitly clearing tax_template_id by passing null
  const hasTaxUpdate = 'tax_template_id' in data;
  const hasReorderUpdate = reorder_level !== undefined && reorder_level !== null && reorder_level !== '';

  return transaction(async (client) => {
    const { rows } = await client.query(`
      UPDATE products
      SET product_name    = COALESCE($3, product_name),
          barcode         = COALESCE($4, barcode),
          description     = COALESCE($5, description),
          category_id     = COALESCE($6, category_id),
          base_price      = COALESCE($7::numeric, base_price),
          cost_price      = COALESCE($8::numeric, cost_price),
          unit_of_measure = COALESCE($9, unit_of_measure),
          is_active       = COALESCE($10, is_active),
          image_url       = COALESCE($11, image_url),
          tax_template_id = CASE WHEN $12 THEN $13 ELSE tax_template_id END
      WHERE company_id = $1 AND product_id = $2 AND deleted_at IS NULL
      RETURNING *
    `, [companyId, productId,
      product_name ?? null, barcode ?? null, description ?? null, category_id ?? null,
      base_price ?? null, cost_price ?? null, unit_of_measure ?? null, is_active ?? null,
      image_url ?? null, hasTaxUpdate, tax_template_id ?? null]);

    if (!rows.length) throw AppError.notFound('Product');

    // Reorder level lives per-branch — apply the same value across every active branch
    // so it stays a single field on the product edit form.
    if (hasReorderUpdate) {
      const level = parseInt(reorder_level) || 0;
      const { rows: branches } = await client.query(
        `SELECT branch_id FROM branches WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [companyId]
      );
      for (const b of branches) {
        await client.query(`
          INSERT INTO product_branch_inventory (product_id, branch_id, reorder_level)
          VALUES ($1, $2, $3)
          ON CONFLICT (product_id, branch_id) DO UPDATE
            SET reorder_level = EXCLUDED.reorder_level, last_updated = now()
        `, [productId, b.branch_id, level]);
      }
    }

    return rows[0];
  });
}

async function createCategory(companyId, { category_name, parent_category_id }) {
  const { rows } = await query(`
    INSERT INTO categories (company_id, category_name, parent_category_id)
    VALUES ($1,$2,$3) RETURNING *
  `, [companyId, category_name, parent_category_id || null]);
  return rows[0];
}

async function updateCategory(companyId, categoryId, { category_name }) {
  const { rows } = await query(`
    UPDATE categories SET category_name = $3
    WHERE company_id = $1 AND category_id = $2
    RETURNING *
  `, [companyId, categoryId, category_name]);
  if (!rows.length) throw AppError.notFound('Category');
  return rows[0];
}

async function listBranchPricing(companyId, productId) {
  const { rows } = await query(`
    SELECT b.branch_id, b.branch_name,
           pbp.pricing_id, pbp.selling_price::numeric, pbp.special_price::numeric,
           p.base_price::numeric
    FROM branches b
    LEFT JOIN product_branch_pricing pbp ON pbp.product_id = $2 AND pbp.branch_id = b.branch_id
    JOIN products p ON p.product_id = $2 AND p.company_id = $1
    WHERE b.company_id = $1 AND b.is_active = TRUE
    ORDER BY b.branch_name
  `, [companyId, productId]);
  return rows.map((r) => ({
    branch_id:     r.branch_id,
    branch_name:   r.branch_name,
    pricing_id:    r.pricing_id,
    selling_price: r.selling_price  ? parseFloat(r.selling_price)  : null,
    special_price: r.special_price  ? parseFloat(r.special_price)  : null,
    base_price:    parseFloat(r.base_price),
  }));
}

async function upsertBranchPricing(companyId, productId, { branchId, selling_price, special_price }) {
  const { rows: check } = await query(
    `SELECT 1 FROM branches WHERE branch_id = $1 AND company_id = $2`,
    [branchId, companyId]
  );
  if (!check.length) throw AppError.notFound('Branch');

  if (selling_price === null || selling_price === undefined) {
    await query(
      `DELETE FROM product_branch_pricing WHERE product_id = $1 AND branch_id = $2`,
      [productId, branchId]
    );
    return { branch_id: branchId, selling_price: null, special_price: null };
  }

  const { rows } = await query(`
    INSERT INTO product_branch_pricing (product_id, branch_id, selling_price, special_price)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (product_id, branch_id) DO UPDATE
      SET selling_price = EXCLUDED.selling_price,
          special_price = EXCLUDED.special_price
    RETURNING pricing_id, selling_price::numeric, special_price::numeric
  `, [productId, branchId, selling_price, special_price || null]);

  return {
    branch_id:     branchId,
    pricing_id:    rows[0].pricing_id,
    selling_price: parseFloat(rows[0].selling_price),
    special_price: rows[0].special_price ? parseFloat(rows[0].special_price) : null,
  };
}

async function deleteProduct(companyId, productId, deletedBy) {
  const { rows } = await query(`
    UPDATE products
    SET deleted_at = now(), deleted_by = $3, is_active = FALSE, updated_at = now()
    WHERE company_id = $1 AND product_id = $2 AND deleted_at IS NULL
    RETURNING product_id
  `, [companyId, productId, deletedBy]);

  if (!rows.length) throw AppError.notFound('Product');
}

async function bulkImportProducts(companyId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw AppError.badRequest('No products provided');
  if (rows.length > 500) throw AppError.badRequest('Maximum 500 products per import');

  return transaction(async (client) => {
    // Pre-fetch categories and branches once
    const { rows: cats } = await client.query(
      `SELECT category_id, LOWER(category_name) AS lname FROM categories WHERE company_id = $1 AND is_active = TRUE`,
      [companyId]
    );
    const catMap = Object.fromEntries(cats.map((c) => [c.lname, c.category_id]));

    const { rows: branches } = await client.query(
      `SELECT branch_id FROM branches WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [companyId]
    );

    // Fetch existing SKUs to detect duplicates within import + DB
    const { rows: existingSKUs } = await client.query(
      `SELECT sku FROM products WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    const skuSet = new Set(existingSKUs.map((r) => r.sku));

    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      const product_name  = (row.product_name || '').trim();
      const sku           = (row.sku || '').trim() || null;
      const barcode       = (row.barcode || '').trim() || null;
      const description   = (row.description || '').trim() || null;
      const base_price    = parseFloat(row.base_price);
      const cost_price    = row.cost_price !== '' && row.cost_price != null ? parseFloat(row.cost_price) : null;
      const unit_of_measure = (row.unit_of_measure || 'Unit').trim();
      const reorder_level = parseInt(row.reorder_level) || 0;
      const initial_stock = parseFloat(row.initial_stock) || 0;
      const category_id   = row.category_name
        ? (catMap[row.category_name.toLowerCase()] ?? null)
        : null;

      if (!product_name) {
        results.push({ row: rowNum, success: false, error: 'product_name is required' });
        continue;
      }
      if (isNaN(base_price) || base_price < 0) {
        results.push({ row: rowNum, success: false, error: 'base_price must be a valid number', product_name });
        continue;
      }
      if (sku && skuSet.has(sku)) {
        results.push({ row: rowNum, success: false, error: `SKU "${sku}" already exists`, product_name });
        continue;
      }

      try {
        const { rows: inserted } = await client.query(`
          INSERT INTO products (
            company_id, product_name, sku, barcode, description,
            category_id, base_price, cost_price, unit_of_measure
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING product_id, product_name, sku
        `, [companyId, product_name, sku, barcode, description,
            category_id, base_price, cost_price ?? null, unit_of_measure]);

        const product = inserted[0];
        if (sku) skuSet.add(sku); // track within this batch

        for (const b of branches) {
          await client.query(`
            INSERT INTO product_branch_inventory (product_id, branch_id, quantity_available, reorder_level)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (product_id, branch_id) DO NOTHING
          `, [product.product_id, b.branch_id, initial_stock, reorder_level]);
        }

        results.push({ row: rowNum, success: true, product_id: product.product_id, product_name: product.product_name });
      } catch (err) {
        results.push({ row: rowNum, success: false, error: err.message, product_name });
      }
    }

    const imported = results.filter((r) => r.success).length;
    const failed   = results.filter((r) => !r.success).length;
    return { imported, failed, total: rows.length, results };
  });
}

const TRUE_WORDS  = new Set(['true', '1', 'yes', 'active']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'inactive']);

async function bulkUpdateProducts(companyId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw AppError.badRequest('No updates provided');
  if (rows.length > 500) throw AppError.badRequest('Maximum 500 rows per bulk edit');

  return transaction(async (client) => {
    const { rows: cats } = await client.query(
      `SELECT category_id, LOWER(category_name) AS lname FROM categories WHERE company_id = $1 AND is_active = TRUE`,
      [companyId]
    );
    const catMap = Object.fromEntries(cats.map((c) => [c.lname, c.category_id]));

    const { rows: taxes } = await client.query(
      `SELECT tax_template_id, LOWER(template_name) AS lname FROM tax_templates WHERE company_id = $1`,
      [companyId]
    );
    const taxMap = Object.fromEntries(taxes.map((t) => [t.lname, t.tax_template_id]));

    const { rows: existing } = await client.query(
      `SELECT product_id, sku FROM products WHERE company_id = $1 AND deleted_at IS NULL AND sku IS NOT NULL`,
      [companyId]
    );
    const skuMap = Object.fromEntries(existing.map((p) => [p.sku, p.product_id]));

    const { rows: branches } = await client.query(
      `SELECT branch_id FROM branches WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [companyId]
    );

    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      const sku = (row.sku || '').trim();

      if (!sku) {
        results.push({ row: rowNum, success: false, error: 'sku is required' });
        continue;
      }
      const productId = skuMap[sku];
      if (!productId) {
        results.push({ row: rowNum, success: false, error: `SKU "${sku}" not found`, sku });
        continue;
      }

      const has = (k) => row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '';

      let categoryId; // undefined = leave unchanged
      if (has('category_name')) {
        categoryId = catMap[row.category_name.trim().toLowerCase()];
        if (!categoryId) {
          results.push({ row: rowNum, success: false, error: `Unknown category_name "${row.category_name}"`, sku });
          continue;
        }
      }

      let taxTemplateId;
      if (has('tax_template_name')) {
        taxTemplateId = taxMap[row.tax_template_name.trim().toLowerCase()];
        if (!taxTemplateId) {
          results.push({ row: rowNum, success: false, error: `Unknown tax_template_name "${row.tax_template_name}"`, sku });
          continue;
        }
      }

      let basePrice;
      if (has('base_price')) {
        basePrice = parseFloat(row.base_price);
        if (isNaN(basePrice) || basePrice < 0) {
          results.push({ row: rowNum, success: false, error: 'base_price must be a valid number', sku });
          continue;
        }
      }

      let costPrice;
      if (has('cost_price')) {
        costPrice = parseFloat(row.cost_price);
        if (isNaN(costPrice) || costPrice < 0) {
          results.push({ row: rowNum, success: false, error: 'cost_price must be a valid number', sku });
          continue;
        }
      }

      let isActive;
      if (has('is_active')) {
        const v = String(row.is_active).trim().toLowerCase();
        if (TRUE_WORDS.has(v)) isActive = true;
        else if (FALSE_WORDS.has(v)) isActive = false;
        else {
          results.push({ row: rowNum, success: false, error: `is_active must be true/false, got "${row.is_active}"`, sku });
          continue;
        }
      }

      let reorderLevel;
      if (has('reorder_level')) {
        reorderLevel = parseInt(row.reorder_level);
        if (isNaN(reorderLevel) || reorderLevel < 0) {
          results.push({ row: rowNum, success: false, error: 'reorder_level must be a whole number ≥ 0', sku });
          continue;
        }
      }

      const productName    = has('product_name')    ? row.product_name.trim()    : undefined;
      const barcode        = has('barcode')          ? row.barcode.trim()        : undefined;
      const description    = has('description')      ? row.description.trim()    : undefined;
      const unitOfMeasure  = has('unit_of_measure')  ? row.unit_of_measure.trim(): undefined;

      const noFieldsGiven = [
        productName, barcode, description, unitOfMeasure,
        categoryId, taxTemplateId, basePrice, costPrice, isActive, reorderLevel,
      ].every((v) => v === undefined);

      if (noFieldsGiven) {
        results.push({ row: rowNum, success: false, error: 'No fields to update', sku });
        continue;
      }

      const { rows: updated } = await client.query(`
        UPDATE products
        SET product_name    = COALESCE($3, product_name),
            barcode         = COALESCE($4, barcode),
            description     = COALESCE($5, description),
            unit_of_measure = COALESCE($6, unit_of_measure),
            category_id     = COALESCE($7, category_id),
            tax_template_id = COALESCE($8, tax_template_id),
            base_price      = COALESCE($9::numeric, base_price),
            cost_price      = COALESCE($10::numeric, cost_price),
            is_active       = COALESCE($11, is_active),
            updated_at      = now()
        WHERE company_id = $1 AND product_id = $2 AND deleted_at IS NULL
        RETURNING product_id, sku, product_name
      `, [companyId, productId,
        productName ?? null, barcode ?? null, description ?? null, unitOfMeasure ?? null,
        categoryId ?? null, taxTemplateId ?? null, basePrice ?? null, costPrice ?? null,
        isActive ?? null]);

      const p = updated[0];

      if (reorderLevel !== undefined) {
        for (const b of branches) {
          await client.query(`
            INSERT INTO product_branch_inventory (product_id, branch_id, reorder_level)
            VALUES ($1, $2, $3)
            ON CONFLICT (product_id, branch_id) DO UPDATE
              SET reorder_level = EXCLUDED.reorder_level, last_updated = now()
          `, [p.product_id, b.branch_id, reorderLevel]);
        }
      }

      results.push({ row: rowNum, success: true, product_id: p.product_id, sku: p.sku, product_name: p.product_name });
    }

    const updatedCount = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return { updated: updatedCount, failed, total: rows.length, results };
  });
}

module.exports = {
  listProducts, getProductById, listCategories, updateCategory,
  createProduct, updateProduct, createCategory, deleteProduct,
  listBranchPricing, upsertBranchPricing, bulkImportProducts, bulkUpdateProducts,
};
