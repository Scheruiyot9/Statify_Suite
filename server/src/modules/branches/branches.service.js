const { query, transaction } = require('../../config/database');
const AppError               = require('../../shared/AppError');
const { checkBranchLimit }   = require('../../shared/subscriptionLimits');

async function listBranches(companyId) {
  const { rows } = await query(
    `SELECT branch_id, branch_name, branch_code, address, phone, is_headquarters, is_active, payment_details
     FROM branches
     WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL
     ORDER BY branch_name`,
    [companyId]
  );
  return rows;
}

async function createBranch(companyId, data) {
  const { branch_name, branch_code, address, phone, payment_details } = data;
  if (!branch_name) throw AppError.badRequest('branch_name is required');
  if (!branch_code) throw AppError.badRequest('branch_code is required');

  await checkBranchLimit(companyId);

  const { rows: dup } = await query(
    'SELECT 1 FROM branches WHERE company_id = $1 AND branch_code = $2',
    [companyId, branch_code]
  );
  if (dup.length) throw AppError.conflict('A branch with that code already exists');

  return transaction(async (client) => {
    const { rows: [branch] } = await client.query(`
      INSERT INTO branches (company_id, branch_name, branch_code, address, phone, is_headquarters, is_active, payment_details)
      VALUES ($1, $2, $3, $4, $5, FALSE, TRUE, $6)
      RETURNING branch_id, branch_name, branch_code, address, phone, is_headquarters, is_active, payment_details
    `, [companyId, branch_name, branch_code, address || null, phone || null, payment_details?.trim() || null]);

    // Auto-create inventory rows for all existing products in the new branch
    await client.query(`
      INSERT INTO product_branch_inventory (product_id, branch_id, quantity_available, reorder_level)
      SELECT product_id, $1, 0, 0
      FROM products
      WHERE company_id = $2 AND is_active = TRUE AND deleted_at IS NULL
      ON CONFLICT (product_id, branch_id) DO NOTHING
    `, [branch.branch_id, companyId]);

    return branch;
  });
}

async function updateBranch(companyId, branchId, data) {
  const { branch_name, address, phone, is_active, payment_details } = data;
  // For payment_details: null means "not sent — keep existing"; '' means "clear it"
  const pdParam = payment_details !== undefined ? (payment_details?.trim() ?? '') : null;

  const { rows } = await query(`
    UPDATE branches
    SET branch_name      = COALESCE($3, branch_name),
        address          = COALESCE($4, address),
        phone            = COALESCE($5, phone),
        is_active        = COALESCE($6, is_active),
        payment_details  = CASE WHEN $7::text IS NOT NULL THEN NULLIF(TRIM($7::text), '') ELSE payment_details END
    WHERE company_id = $1 AND branch_id = $2 AND deleted_at IS NULL
    RETURNING branch_id, branch_name, branch_code, address, phone, is_headquarters, is_active, payment_details
  `, [companyId, branchId, branch_name ?? null, address ?? null, phone ?? null, is_active ?? null, pdParam]);

  if (!rows.length) throw AppError.notFound('Branch');
  return rows[0];
}

async function deleteBranch(companyId, branchId, deletedBy) {
  // Prevent deleting the headquarters branch
  const { rows: [branch] } = await query(
    'SELECT is_headquarters FROM branches WHERE company_id = $1 AND branch_id = $2 AND deleted_at IS NULL',
    [companyId, branchId]
  );
  if (!branch) throw AppError.notFound('Branch');
  if (branch.is_headquarters)
    throw AppError.badRequest('Cannot delete the headquarters branch');

  // Prevent deleting a branch with open POS sessions
  const { rows: openSessions } = await query(
    `SELECT 1 FROM pos_sessions WHERE branch_id = $1 AND status = 'open' LIMIT 1`,
    [branchId]
  );
  if (openSessions.length)
    throw AppError.badRequest('Cannot delete a branch with open POS sessions');

  await query(`
    UPDATE branches
    SET deleted_at = now(), deleted_by = $3, is_active = FALSE
    WHERE company_id = $1 AND branch_id = $2 AND deleted_at IS NULL
  `, [companyId, branchId, deletedBy]);
}

module.exports = { listBranches, createBranch, updateBranch, deleteBranch };
