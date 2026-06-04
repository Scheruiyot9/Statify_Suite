const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const { query } = require('../../config/database');
const env      = require('../../config/env');
const AppError = require('../../shared/AppError');
const { sendMail } = require('../../shared/mailer');

const signAccess = (payload) =>
  jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });

const signRefresh = (payload, expiresIn = env.jwt.refreshExpiresIn) =>
  jwt.sign(payload, env.jwt.refreshSecret, { expiresIn });

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

// Build the JWT payload: role, branch assignments, and plan feature flags.
// Permissions are derived server-side from the role via ROLE_PERMISSIONS map
// and are no longer embedded in the token, keeping JWT size constant.
const buildTokenPayload = async (user) => {
  const [branchRes, planRes] = await Promise.all([
    query(`SELECT branch_id FROM user_branch_assignments WHERE user_id = $1`, [user.user_id]),
    // Fetch plan feature flags for tenant users; super_admin has no company
    user.company_id
      ? query(
          `SELECT sp.has_finance, sp.has_api_access
             FROM companies c
             JOIN subscription_plans sp ON sp.plan_id = c.subscription_plan_id
            WHERE c.company_id = $1`,
          [user.company_id]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const plan = planRes.rows[0];
  return {
    userId:    user.user_id,
    companyId: user.company_id,
    role:      user.role_name,
    branchIds: branchRes.rows.map((r) => r.branch_id),
    planFeatures: {
      hasFinance:   user.role_name === 'super_admin' ? true : (plan?.has_finance  ?? false),
      hasApiAccess: user.role_name === 'super_admin' ? true : (plan?.has_api_access ?? false),
    },
  };
};

const login = async ({ email, password }) => {
  const { rows } = await query(
    `SELECT u.user_id, u.company_id, u.password_hash, u.is_active,
            u.first_name, u.last_name, u.must_reset_password, u.pin_hash,
            r.role_name,
            c.subscription_status, c.lock_timeout_minutes, c.session_lifetime_days
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN roles r        ON r.role_id  = ur.role_id
       LEFT JOIN companies c    ON c.company_id = u.company_id
      WHERE u.email = $1
      LIMIT 1`,
    [email.toLowerCase().trim()]
  );

  const user = rows[0];
  if (!user) throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  if (!user.is_active) throw AppError.forbidden('Account is deactivated', 'ACCOUNT_INACTIVE');
  if (user.subscription_status === 'suspended')
    throw AppError.forbidden('Your subscription has expired. Please contact support@statify.co.ke or call +254796265933 to renew.', 'SUBSCRIPTION_EXPIRED');
  if (user.subscription_status === 'cancelled')
    throw AppError.forbidden('Your account has been cancelled. Please contact support@statify.co.ke for assistance.', 'ACCOUNT_CANCELLED');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

  await query('UPDATE users SET last_login = now() WHERE user_id = $1', [user.user_id]);

  const payload      = await buildTokenPayload(user);
  const accessToken  = signAccess(payload);

  // Use the company's configured session lifetime; fall back to the server default
  const sessionDays     = user.session_lifetime_days ?? null;
  const sessionDuration = sessionDays ? `${sessionDays}d` : env.jwt.refreshExpiresIn;
  const refreshToken    = signRefresh({ userId: user.user_id }, sessionDuration);

  // Store hashed refresh token for server-side revocation
  const expiresAt = new Date(Date.now() + parseDuration(sessionDuration));
  await query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.user_id, hashToken(refreshToken), expiresAt]
  );

  return {
    accessToken,
    refreshToken,
    user: {
      userId:              user.user_id,
      firstName:           user.first_name,
      lastName:            user.last_name,
      role:                user.role_name,
      companyId:           user.company_id,
      branchIds:           payload.branchIds,
      planFeatures:        payload.planFeatures,
      mustResetPassword:   user.must_reset_password ?? false,
      hasPinSet:           !!user.pin_hash,
      pinHash:             user.pin_hash ?? null,
      lockTimeoutMinutes:  user.lock_timeout_minutes ?? null,
      sessionLifetimeDays: sessionDays ?? 7,
    },
  };
};

const refresh = async (refreshToken) => {
  if (!refreshToken) throw AppError.unauthorized('Refresh token required', 'INVALID_REFRESH_TOKEN');

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, env.jwt.refreshSecret);
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }

  // Verify the session still exists and hasn't been revoked
  const { rows: sessionRows } = await query(
    `SELECT session_id FROM user_sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(refreshToken)]
  );
  if (!sessionRows.length) {
    throw AppError.unauthorized('Session revoked or expired — please log in again', 'SESSION_REVOKED');
  }

  const { rows } = await query(
    `SELECT u.user_id, u.company_id, u.is_active, r.role_name
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN roles r        ON r.role_id  = ur.role_id
      WHERE u.user_id = $1 LIMIT 1`,
    [decoded.userId]
  );

  if (!rows.length || !rows[0].is_active)
    throw AppError.unauthorized('User not found or inactive', 'USER_INACTIVE');

  const p          = await buildTokenPayload(rows[0]);
  const accessToken = signAccess(p);
  return { accessToken };
};

const logout = async (refreshToken) => {
  if (!refreshToken) return;
  try {
    await query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'logout'
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(refreshToken)]
    );
  } catch {
    // Non-fatal: token may already be expired/unknown
  }
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
  const { rows } = await query(
    'SELECT password_hash FROM users WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) throw AppError.notFound('User');

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) throw AppError.badRequest('Current password is incorrect', 'WRONG_PASSWORD');

  const hash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await query(
    'UPDATE users SET password_hash = $1, must_reset_password = FALSE, updated_at = now() WHERE user_id = $2',
    [hash, userId]
  );

  // Revoke all active sessions — force re-login everywhere after password change
  await query(
    `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'password_change'
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
};

const forgotPassword = async ({ email }) => {
  const { rows } = await query(
    `SELECT user_id, first_name FROM users
      WHERE email = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1`,
    [email.toLowerCase().trim()]
  );

  // Silently return when email not found — prevents account enumeration
  if (!rows.length) return;

  const user = rows[0];

  // Expire any existing unused tokens for this user
  await query(
    `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
    [user.user_id]
  );

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.user_id, tokenHash, expiresAt]
  );

  const resetLink = `${env.appUrl}/reset-password?token=${rawToken}`;

  await sendMail({
    to: email,
    subject: 'Reset your Statify POS password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px">
        <h2 style="color:#024A59;margin-bottom:8px">Password Reset Request</h2>
        <p style="color:#374151">Hi ${user.first_name},</p>
        <p style="color:#374151">You requested a password reset for your Statify POS account. Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetLink}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#024A59;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
        <p style="color:#6B7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0"/>
        <p style="color:#9CA3AF;font-size:12px">Statify POS · support@statify.co.ke · +254796265933</p>
      </div>
    `,
    text: `Hi ${user.first_name},\n\nReset your Statify POS password:\n${resetLink}\n\nThis link expires in 1 hour.\n\n— Statify POS`,
  });
};

const resetPassword = async ({ token, newPassword }) => {
  if (!token || !newPassword) throw AppError.badRequest('Token and new password are required');
  if (newPassword.length < 8) throw AppError.badRequest('Password must be at least 8 characters');

  const tokenHash = hashToken(token);
  const { rows } = await query(
    `SELECT prt.token_id, prt.user_id FROM password_reset_tokens prt
      WHERE prt.token_hash = $1
        AND prt.used_at IS NULL
        AND prt.expires_at > now()
      LIMIT 1`,
    [tokenHash]
  );

  if (!rows.length)
    throw AppError.badRequest('This reset link is invalid or has expired. Please request a new one.', 'INVALID_RESET_TOKEN');

  const { token_id, user_id } = rows[0];
  const hash = await bcrypt.hash(newPassword, env.bcryptRounds);

  await query(
    `UPDATE users SET password_hash = $1, must_reset_password = FALSE, updated_at = now() WHERE user_id = $2`,
    [hash, user_id]
  );
  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE token_id = $1`, [token_id]);
  // Revoke all sessions to force fresh login
  await query(
    `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'password_reset'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user_id]
  );
};

const submitInterest = async ({ fullName, email, phone, businessName, message }) => {
  if (!fullName || !email || !businessName)
    throw AppError.badRequest('Name, email, and business name are required');

  await query(
    `INSERT INTO subscription_interests (full_name, email, phone, business_name, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [fullName.trim(), email.toLowerCase().trim(), phone?.trim() || null, businessName.trim(), message?.trim() || null]
  );

  await sendMail({
    to: 'support@statify.co.ke',
    subject: `New subscription interest: ${businessName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px">
        <h2 style="color:#024A59">New Subscription Interest</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151">
          <tr><td style="padding:6px 0;font-weight:600;width:130px">Name</td><td>${fullName}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600">Email</td><td>${email}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600">Phone</td><td>${phone || '—'}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600">Business</td><td>${businessName}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600;vertical-align:top">Message</td><td>${message || '—'}</td></tr>
        </table>
      </div>
    `,
    text: `New interest:\nName: ${fullName}\nEmail: ${email}\nPhone: ${phone}\nBusiness: ${businessName}\nMessage: ${message}`,
  });
};

// Convert JWT duration strings like '7d', '15m', '1h' to milliseconds
function parseDuration(str) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const m = String(str).match(/^(\d+)([smhdw])$/);
  if (!m) return 7 * 86400000; // default 7 days
  return parseInt(m[1], 10) * (units[m[2]] || 86400000);
}

// ── PIN lock ──────────────────────────────────────────────────────────────────
// The pin_hash is computed client-side as SHA-256(pin:userId) so it also works
// offline.  The server stores it for persistence and cross-device sync.

const setPin = async (userId, { pinHash }) => {
  if (typeof pinHash !== 'string' || !/^[0-9a-f]{64}$/.test(pinHash))
    throw AppError.badRequest('Invalid pin hash');
  await query(
    'UPDATE users SET pin_hash = $1, updated_at = now() WHERE user_id = $2',
    [pinHash, userId]
  );
  return { success: true };
};

const verifyPin = async (userId, { pinHash }) => {
  if (typeof pinHash !== 'string' || !/^[0-9a-f]{64}$/.test(pinHash))
    throw AppError.badRequest('Invalid pin hash');
  const { rows } = await query(
    'SELECT pin_hash FROM users WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) throw AppError.notFound('User');
  if (!rows[0].pin_hash) throw AppError.badRequest('PIN not set', 'PIN_NOT_SET');
  return { valid: rows[0].pin_hash === pinHash };
};

// Enriched /me — adds live data that isn't in the JWT
const getMe = async (userId, companyId) => {
  const { rows } = await query(
    `SELECT u.pin_hash,
            c.lock_timeout_minutes,
            c.session_lifetime_days
       FROM users u
       LEFT JOIN companies c ON c.company_id = u.company_id
      WHERE u.user_id = $1`,
    [userId]
  );
  if (!rows.length) throw AppError.notFound('User');
  return {
    hasPinSet:           !!rows[0].pin_hash,
    pinHash:             rows[0].pin_hash ?? null,
    lockTimeoutMinutes:  rows[0].lock_timeout_minutes ?? null,
    sessionLifetimeDays: rows[0].session_lifetime_days ?? 7,
  };
};

module.exports = {
  login, refresh, logout, changePassword, forgotPassword, resetPassword,
  submitInterest, setPin, verifyPin, getMe,
};
