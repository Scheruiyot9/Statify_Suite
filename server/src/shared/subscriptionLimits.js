const { query } = require('../config/database');
const AppError  = require('./AppError');

// Throws PLAN_LIMIT_REACHED if the company is at or above its plan's user cap.
// max_users = NULL means unlimited (no plan assigned or plan has no cap).
async function checkUserLimit(companyId) {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM users
       WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL) AS current_users,
      sp.max_users
    FROM companies c
    LEFT JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
    WHERE c.company_id = $1
  `, [companyId]);

  if (!rows.length) return;
  const { current_users, max_users } = rows[0];
  if (max_users !== null && parseInt(current_users) >= parseInt(max_users)) {
    throw AppError.forbidden(
      `User limit reached (${current_users}/${max_users}). Upgrade your plan to add more users.`,
      'PLAN_LIMIT_REACHED'
    );
  }
}

// Throws PLAN_LIMIT_REACHED if the company is at or above its plan's branch cap.
async function checkBranchLimit(companyId) {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM branches
       WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL) AS current_branches,
      sp.max_branches
    FROM companies c
    LEFT JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
    WHERE c.company_id = $1
  `, [companyId]);

  if (!rows.length) return;
  const { current_branches, max_branches } = rows[0];
  if (max_branches !== null && parseInt(current_branches) >= parseInt(max_branches)) {
    throw AppError.forbidden(
      `Branch limit reached (${current_branches}/${max_branches}). Upgrade your plan to add more branches.`,
      'PLAN_LIMIT_REACHED'
    );
  }
}

module.exports = { checkUserLimit, checkBranchLimit };
