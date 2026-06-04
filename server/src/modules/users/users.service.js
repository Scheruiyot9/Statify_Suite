const { query, transaction }       = require('../../config/database');
const bcrypt                        = require('bcryptjs');
const crypto                        = require('crypto');
const AppError                      = require('../../shared/AppError');
const env                           = require('../../config/env');
const { checkUserLimit }            = require('../../shared/subscriptionLimits');
const QueryBuilder                  = require('../../shared/qb');
const { sendMail }                  = require('../../shared/mailer');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Generate a secure random temporary password: 12 chars, url-safe base64
const generateTempPassword = () => crypto.randomBytes(9).toString('base64url');

async function listUsers(companyId, { search, role, branchId, page = 1, limit = 25 } = {}) {
  const qb = new QueryBuilder([companyId]);
  const conditions = ['u.company_id = $1'];

  if (search) {
    const p = qb.add(`%${search}%`);
    conditions.push(`(u.first_name ILIKE $${p} OR u.last_name ILIKE $${p} OR u.email ILIKE $${p})`);
  }
  if (role) {
    conditions.push(`r.role_name = $${qb.add(role)}`);
  }
  if (branchId) {
    conditions.push(`uba.branch_id = $${qb.add(branchId)}`);
  }

  const pg = parseInt(page, 10);
  const lm = parseInt(limit, 10);
  const limIdx = qb.add(lm);
  const offIdx = qb.add((pg - 1) * lm);

  const { rows } = await query(`
    SELECT
      u.user_id, u.first_name, u.last_name, u.email, u.username, u.phone,
      u.is_active, u.last_login, u.created_at,
      r.role_name, r.role_id,
      uba.branch_id,
      (SELECT b2.branch_name FROM branches b2 WHERE b2.branch_id = uba.branch_id) AS branch_name,
      COUNT(*) OVER() AS total_count
    FROM users u
    LEFT JOIN user_roles ur  ON ur.user_id  = u.user_id
    LEFT JOIN roles r        ON r.role_id   = ur.role_id
    LEFT JOIN user_branch_assignments uba ON uba.user_id = u.user_id AND uba.is_default_branch = TRUE
    WHERE ${conditions.join(' AND ')} AND u.deleted_at IS NULL
    ORDER BY u.first_name, u.last_name
    LIMIT $${limIdx} OFFSET $${offIdx}
  `, qb.params);

  const total = rows.length ? parseInt(rows[0].total_count) : 0;
  return {
    users: rows.map((r) => ({
      user_id:    r.user_id,
      first_name: r.first_name,
      last_name:  r.last_name,
      email:      r.email,
      username:   r.username,
      phone:      r.phone,
      is_active:  r.is_active,
      last_login: r.last_login,
      created_at: r.created_at,
      role_name:  r.role_name,
      role_id:    r.role_id,
      branch_id:  r.branch_id,
      branch_name: r.branch_name,
    })),
    total, page: pg, limit: lm, pages: Math.ceil(total / lm),
  };
}

async function listRoles(companyId) {
  const { rows } = await query(
    `SELECT role_id, role_name FROM roles
     WHERE (company_id = $1 OR (company_id IS NULL AND role_name != 'super_admin'))
     ORDER BY role_name`,
    [companyId]
  );
  return rows;
}

async function listRolesWithPermissions(companyId) {
  // Get all roles for this company
  const { rows: roles } = await query(
    `SELECT role_id, role_name, description
     FROM roles
     WHERE (company_id = $1 OR (company_id IS NULL AND role_name != 'super_admin'))
     ORDER BY role_name`,
    [companyId]
  );

  if (!roles.length) return [];

  // Get all permissions with their module grouping
  const { rows: perms } = await query(
    `SELECT p.permission_id, p.permission_code, p.permission_name, p.module_name,
            rp.role_id,
            rp.can_create, rp.can_read, rp.can_update, rp.can_delete, rp.can_export
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.permission_id
     WHERE rp.role_id = ANY($1)
     ORDER BY p.module_name, p.permission_name`,
    [roles.map((r) => r.role_id)]
  );

  // Build a map: roleId -> Set of permission_codes
  const rolePermMap = {};
  for (const r of roles) rolePermMap[r.role_id] = [];
  for (const p of perms) {
    rolePermMap[p.role_id].push({
      permission_code: p.permission_code,
      permission_name: p.permission_name,
      module_name:     p.module_name,
      can_create:      p.can_create,
      can_read:        p.can_read,
      can_update:      p.can_update,
      can_delete:      p.can_delete,
      can_export:      p.can_export,
    });
  }

  return roles.map((r) => ({
    role_id:     r.role_id,
    role_name:   r.role_name,
    description: r.description,
    permissions: rolePermMap[r.role_id] ?? [],
  }));
}

async function createUser(companyId, data) {
  const { first_name, last_name, email, username, phone, role_id, branch_id } = data;
  if (!first_name || !email) throw AppError.badRequest('first_name and email are required');
  // Always generate a secure random temp password — admin must share it with the user
  const password = generateTempPassword();

  await checkUserLimit(companyId);

  const emailLower = email.toLowerCase().trim();
  const { rows: dup } = await query('SELECT 1 FROM users WHERE email = $1', [emailLower]);
  if (dup.length) throw AppError.conflict('A user with this email already exists');

  const password_hash = await bcrypt.hash(password, env.bcryptRounds);

  // Derive a username from the email local-part if one wasn't supplied, then
  // ensure uniqueness by appending a numeric suffix when needed.
  const baseUsername = (username || emailLower.split('@')[0])
    .replace(/[^a-z0-9._-]/gi, '')
    .slice(0, 60) || 'user';

  const { rows: existing } = await query(
    `SELECT username FROM users WHERE username ILIKE $1 OR username ILIKE $2`,
    [baseUsername, `${baseUsername}\\_%`]
  );
  const taken = new Set(existing.map((r) => r.username.toLowerCase()));
  let resolvedUsername = baseUsername;
  let suffix = 1;
  while (taken.has(resolvedUsername.toLowerCase())) {
    resolvedUsername = `${baseUsername}_${suffix++}`;
  }

  const user = await transaction(async (client) => {
    const { rows } = await client.query(`
      INSERT INTO users (company_id, first_name, last_name, email, username, phone, password_hash, must_reset_password)
      VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
      RETURNING user_id, first_name, last_name, email, username, phone, is_active, created_at
    `, [companyId, first_name, last_name, emailLower, resolvedUsername, phone || null, password_hash]);

    const newUser = rows[0];

    if (role_id) {
      await client.query(`
        INSERT INTO user_roles (user_role_id, user_id, role_id)
        VALUES (gen_random_uuid(), $1, $2) ON CONFLICT DO NOTHING
      `, [newUser.user_id, role_id]);
    }

    if (branch_id) {
      await client.query(`
        INSERT INTO user_branch_assignments (assignment_id, user_id, branch_id, is_default_branch)
        VALUES (gen_random_uuid(), $1, $2, TRUE) ON CONFLICT DO NOTHING
      `, [newUser.user_id, branch_id]);
    }

    return newUser;
  });

  // Generate a set-password token (48 h) and email it to the new user
  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.user_id]);
  const rawToken  = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.user_id, hashToken(rawToken), expiresAt]
  );

  const setupLink = `${env.appUrl}/reset-password?token=${rawToken}`;
  const displayName = [first_name, last_name].filter(Boolean).join(' ');
  await sendMail({
    to: emailLower,
    subject: 'Your Statify POS account is ready — set your password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px">
        <h2 style="color:#024A59;margin-bottom:8px">Welcome to Statify POS</h2>
        <p style="color:#374151">Hi ${displayName},</p>
        <p style="color:#374151">An account has been created for you. Click the button below to set your password and sign in. This link expires in 48 hours.</p>
        <a href="${setupLink}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#024A59;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Set my password</a>
        <p style="color:#6B7280;font-size:13px">If you weren't expecting this, you can safely ignore it.</p>
        <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0"/>
        <p style="color:#9CA3AF;font-size:12px">Statify POS · support@statify.co.ke · +254796265933</p>
      </div>
    `,
    text: `Hi ${displayName},\n\nYour Statify POS account is ready. Set your password here:\n${setupLink}\n\nThis link expires in 48 hours.\n\n— Statify POS`,
  });

  // Return temp password once so the admin can share it as a fallback
  return { ...user, temp_password: password };
}

async function updateUser(companyId, userId, data) {
  const { first_name, last_name, phone, is_active, role_id, branch_id } = data;

  return transaction(async (client) => {
    // 1. Core user fields
    const { rows } = await client.query(`
      UPDATE users
      SET first_name = COALESCE($3, first_name),
          last_name  = COALESCE($4, last_name),
          phone      = COALESCE($5, phone),
          is_active  = COALESCE($6, is_active),
          updated_at = now()
      WHERE company_id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING user_id, first_name, last_name, email, phone, is_active
    `, [companyId, userId, first_name ?? null, last_name ?? null, phone ?? null, is_active ?? null]);

    if (!rows.length) throw AppError.notFound('User');

    // 2. Role — replace entirely when a new role_id is supplied
    if (role_id != null && role_id !== '') {
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
      await client.query(`
        INSERT INTO user_roles (user_role_id, user_id, role_id)
        VALUES (gen_random_uuid(), $1, $2) ON CONFLICT DO NOTHING
      `, [userId, role_id]);
    }

    // 3. Default branch — replace when branch_id key is present in payload
    if (Object.prototype.hasOwnProperty.call(data, 'branch_id')) {
      await client.query(
        `DELETE FROM user_branch_assignments WHERE user_id = $1 AND is_default_branch = TRUE`,
        [userId]
      );
      if (branch_id) {
        await client.query(`
          INSERT INTO user_branch_assignments (assignment_id, user_id, branch_id, is_default_branch)
          VALUES (gen_random_uuid(), $1, $2, TRUE) ON CONFLICT DO NOTHING
        `, [userId, branch_id]);
      }
    }

    return rows[0];
  });
}

async function resetPassword(companyId, userId, { newPassword }) {
  if (!newPassword || newPassword.length < 8) throw AppError.badRequest('Password must be at least 8 characters');
  const hash = await bcrypt.hash(newPassword, env.bcryptRounds);

  const { rows } = await query(
    `UPDATE users SET password_hash = $3, updated_at = now()
     WHERE company_id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING user_id`,
    [companyId, userId, hash]
  );
  if (!rows.length) throw AppError.notFound('User');
}

async function deleteUser(companyId, userId, deletedBy) {
  if (userId === deletedBy)
    throw AppError.badRequest('You cannot delete your own account');

  const { rows } = await query(`
    UPDATE users
    SET deleted_at = now(), deleted_by = $3, is_active = FALSE, updated_at = now()
    WHERE company_id = $1 AND user_id = $2 AND deleted_at IS NULL
    RETURNING user_id
  `, [companyId, userId, deletedBy]);

  if (!rows.length) throw AppError.notFound('User');
}

// Clear a user's lock PIN — called by company_admin when a user is locked out
async function clearPin(companyId, userId) {
  const { rows } = await query(
    `UPDATE users
        SET pin_hash = NULL, updated_at = now()
      WHERE company_id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING user_id`,
    [companyId, userId]
  );
  if (!rows.length) throw AppError.notFound('User');
}

module.exports = {
  listUsers, listRoles, listRolesWithPermissions,
  createUser, updateUser, resetPassword, deleteUser, clearPin,
};
